/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2018 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements  */
import * as GraphQL      from "graphql"
import * as GraphQLTools from "graphql-tools"
import GraphQLTypes      from "graphql-tools-types"
import GraphQLSubscribe  from "graphql-tools-subscribe"
import Boom              from "boom"
import textframe         from "textframe"
import PubSub            from "ipc-pubsub"
import KeyVal            from "ipc-keyval"
import SysLoad           from "sysload"
import cluster           from "cluster"

/*  internal requirements  */
import pkg               from "../package.json"

/*  the GraphQL functionality  */
export default class GraphQLService {
    static async start () {
        /*  setup IPC communication bus  */
        this._.bus = new PubSub(this.$.pubsub.match(/^mpm:/) ? this.$.pubsub + ":bus" : this.$.pubsub)
        await this._.bus.open()

        /*  setup IPC key-value store  */
        this._.kvs = new KeyVal(this.$.keyval.match(/^mpm:/) ? this.$.keyval + ":kvs" : this.$.keyval)
        await this._.kvs.open()

        /*  bootstrap GraphQL subscription framework  */
        this._.sub = new GraphQLSubscribe({
            pubsub: this.$.pubsub.match(/^mpm:/) ? this.$.pubsub + ":subscribe" : this.$.pubsub,
            keyval: this.$.keyval.match(/^mpm:/) ? this.$.keyval + ":subscribe" : this.$.keyval
        })
        this._.sub.on("debug", (log) => {
            this.debug(2, `GraphQL Subscribe: ${log}`)
        })
        await this._.sub.open()

        /*  start with a mininum GraphQL schema and resolver  */
        let schema = ""
        let resolver = { Root: {} }

        /*  let application extend GraphQL schema and resolver  */
        let apiSchema   = this.hook("graphql-schema",   "concat")
        let apiResolver = this.hook("graphql-resolver", "concat", resolver)

        /*  extend schema  */
        apiSchema.forEach((api) => {
            schema += textframe(api)
        })

        /*  complete schema  */
        if (!schema.match(/\btype\s+Root\s*\{/)) {
            schema = textframe(`
                type Root {
                }
            `) + schema
        }
        if (!schema.match(/\bschema\s*\{/)) {
            schema = textframe(`
                schema {
                    query:    Root
                    mutation: Root
                }
            `) + schema
        }

        /*  extend resolver (and optionally schema)  */
        const mixinSchema = (type, value) => {
            if (type === "root")
                schema += "\n" + textframe(value)
            else {
                let re = new RegExp(`(type\\s+${type}\\s*(?:implements\\s+\\S+)?\\s*\\{(?:.|\\r?\\n)*?)(\\})`)
                let m = schema.match(re)
                if (m === null)
                    throw new Error(`schema for ${type} not found`)
                schema = schema.replace(re, `$1${textframe(value)}$2`)
            }
        }
        const mixinResolver = (type, attr, value) => {
            if (type === "root") {
                if (resolver[attr] !== undefined)
                    throw new Error(`resolver for <root>.${attr} already exists`)
                resolver[attr] = value
            }
            else {
                if (resolver[type] === undefined)
                    resolver[type] = {}
                if (resolver[type][attr] !== undefined)
                    throw new Error(`resolver for ${type}.${attr} already exists`)
                resolver[type][attr] = value
            }
        }
        apiResolver.forEach((api) => {
            Object.keys(api).forEach((type) => {
                Object.keys(api[type]).forEach((attr) => {
                    if (typeof api[type][attr] === "function")
                        mixinResolver(type, attr, api[type][attr])
                    else if (typeof api[type][attr] === "object" && api[type][attr] instanceof Array) {
                        let [ d, r ] = api[type][attr]
                        mixinSchema(type, d)
                        mixinResolver(type, attr, r)
                    }
                    else
                        throw new Error(`invalid GraphQL resolver entry under path "${type}.${attr}" ` +
                            "(expected function or array)")
                })
            })
        })

        /*  mixin standard add-on GraphQL schema types and resolver  */
        mixinSchema("root", "scalar JSON")
        mixinSchema("root", "scalar UUID")
        mixinSchema("root", "scalar Void")
        mixinResolver("root", "JSON", GraphQLTypes.JSON({ name: "JSON" }))
        mixinResolver("root", "UUID", GraphQLTypes.UUID({ name: "UUID", storage: "string" }))
        mixinResolver("root", "Void", GraphQLTypes.Void({ name: "Void" }))

        /*  mixin GraphQL server information into schema and resolver  */
        mixinSchema("Root", "_Server: _Server")
        mixinSchema("root", `
            #   Information about GraphQL-IO Server
            type _Server {
                #   name of GraphQL-IO Server
                name: String

                #   version of GraphQL-IO Server
                version: String

                #   number of client connections
                #   (updates on demand, every 1s at maximum)
                clients: Int

                #   application load averages (in requests/second) within last 10s, 1m, 10m, 1h, 10h
                #   (updates regularly, every 5s)
                requests: [Float]!

                #   system load averages (in CPU percent) within last 10s, 1m, 10m, 1h, 10h
                #   (updates regularly, every 5s)
                load: [Float]!
            }
        `)
        let server = {
            name:     pkg.name,
            version:  pkg.version,
            load:     [ 0, 0, 0, 0, 0 ],
            requests: [ 0, 0, 0, 0, 0 ],
            clients:  0
        }
        const serverInfo = {
            root:     { type: "_Server",          oid: 0 },
            load:     { type: "_Server_load",     oid: 1 },
            requests: { type: "_Server_requests", oid: 2 },
            clients:  { type: "_Server_clients",  oid: 3 }
        }
        this._.kvs.put("server", server)
        mixinResolver("Root", "_Server", (obj, args, ctx, info) => {
            ctx.scope.record(serverInfo.root.type, serverInfo.root.oid, "read", "direct", "one")
            return this._.kvs.get("server")
        })
        mixinResolver("_Server", "load", (obj, args, ctx, info) => {
            ctx.scope.record(serverInfo.load.type, serverInfo.load.oid, "read", "direct", "one")
            return obj.load
        })
        mixinResolver("_Server", "requests", (obj, args, ctx, info) => {
            ctx.scope.record(serverInfo.requests.type, serverInfo.requests.oid, "read", "direct", "one")
            return obj.requests
        })
        mixinResolver("_Server", "clients", (obj, args, ctx, info) => {
            ctx.scope.record(serverInfo.clients.type, serverInfo.clients.oid, "read", "direct", "one")
            return obj.clients
        })

        /*  perform system load and application load accounting  */
        this._.sysload = new SysLoad({
            "load10s":                   10 * 1,
            "load1m":                6 * 10 * 1,
            "load10m":          10 * 6 * 10 * 1,
            "load1h":       6 * 10 * 6 * 10 * 1,
            "load10h": 10 * 6 * 10 * 6 * 10 * 1
        })
        this._.sysload.start()
        let requestsWithinUnit = 0
        this._.bus.subscribe("client-requests", (num) => {
            requestsWithinUnit++
        })
        let requests = []
        let accountingInterval = 5 * 1000
        this._.timerLoad = null
        if (cluster.isMaster) {
            this._.timerLoad = setInterval(async () => {
                /*  load server instance  */
                await this._.kvs.acquire()
                let server = await this._.kvs.get("server")

                /*  determine system load  */
                let load = this._.sysload.average()
                let changedLoad = false
                if (server.load[0] !== load.load10s) { server.load[0] = load.load10s; changedLoad = true }
                if (server.load[1] !== load.load1m ) { server.load[1] = load.load1m;  changedLoad = true }
                if (server.load[2] !== load.load10m) { server.load[2] = load.load10m; changedLoad = true }
                if (server.load[3] !== load.load1h)  { server.load[3] = load.load1h;  changedLoad = true }
                if (server.load[4] !== load.load10h) { server.load[4] = load.load10h; changedLoad = true }

                /*  determine application load  */
                let changedRequests = false
                const account = (idx, duration, req) => {
                    if (requests[idx] === undefined)
                        requests[idx] = []
                    requests[idx].push(req)
                    if (requests[idx].length > (duration / accountingInterval))
                        requests[idx].shift()
                    load = requests[idx].reduce((sum, val) => sum + val, 0) / requests[idx].length
                    load = load / (accountingInterval / 1000)
                    load = Math.trunc(load * 10) / 10
                    if (server.requests[idx] !== load) {
                        server.requests[idx] = load
                        changedRequests = true
                    }
                }
                account(0,           10 * 1000, requestsWithinUnit)
                account(1,           60 * 1000, requestsWithinUnit)
                account(2,      10 * 60 * 1000, requestsWithinUnit)
                account(3,      60 * 60 * 1000, requestsWithinUnit)
                account(4, 10 * 60 * 60 * 1000, requestsWithinUnit)
                requestsWithinUnit = 0

                /*  save server instance  */
                if (changedLoad || changedRequests)
                    await this._.kvs.put("server", server)
                await this._.kvs.release()

                /*  notify about change  */
                if (changedLoad)
                    this._.sub.scopeRecord(serverInfo.load.type, serverInfo.load.oid, "update", "direct", "one")
                if (changedRequests)
                    this._.sub.scopeRecord(serverInfo.requests.type, serverInfo.requests.oid, "update", "direct", "one")
            }, accountingInterval)
        }

        /*  perform client connection tracking  */
        let clients = 0
        this._.timerConn = null
        this._.bus.subscribe("client-connections", (num) => {
            /*  account client connection  */
            clients += num
            if (clients < 0)
                clients = 0

            /*  perform reporting delay  */
            if (this._.timerConn === null) {
                this._.timerConn = setTimeout(async () => {
                    this._.timerConn = null

                    /*  load server instance  */
                    await this._.kvs.acquire()
                    let server = await this._.kvs.get("server")

                    /*  update server instance  */
                    let changedClients = false
                    if (server.clients !== clients) {
                        server.clients = clients
                        changedClients = true
                    }

                    /*  save server instance  */
                    if (changedClients)
                        await this._.kvs.put("server", server)
                    await this._.kvs.release()

                    /*  notify about change  */
                    if (changedClients)
                        this._.sub.scopeRecord(serverInfo.clients.type, serverInfo.clients.oid, "update", "direct", "one")
                }, 1 * 1000)
            }
        })

        /*  mixin GraphQL subscription into schema and resolver  */
        mixinSchema("Root",          this._.sub.schemaSubscription())
        mixinSchema("root",          "type _Subscription {}")
        mixinSchema("_Subscription", this._.sub.schemaSubscriptions())
        mixinSchema("_Subscription", this._.sub.schemaSubscribe())
        mixinSchema("_Subscription", this._.sub.schemaUnsubscribe())
        mixinSchema("_Subscription", this._.sub.schemaPause())
        mixinSchema("_Subscription", this._.sub.schemaResume())
        mixinResolver("Root",          "_Subscription", this._.sub.resolverSubscription())
        mixinResolver("_Subscription", "subscriptions", this._.sub.resolverSubscriptions())
        mixinResolver("_Subscription", "subscribe",     this._.sub.resolverSubscribe())
        mixinResolver("_Subscription", "unsubscribe",   this._.sub.resolverUnsubscribe())
        mixinResolver("_Subscription", "pause",         this._.sub.resolverPause())
        mixinResolver("_Subscription", "resume",        this._.sub.resolverResume())

        /*  generate GraphQL schema  */
        let schemaExec = GraphQLTools.makeExecutableSchema({
            typeDefs:  [ schema ],
            resolvers: resolver,
            logger: { log: (err) => { this.debug(2, `GraphQL: ERROR: ${err}`) } },
            allowUndefinedInResolve: false,
            resolverValidationOptions: {
                requireResolversForArgs:      true,
                requireResolversForNonScalar: true,
                requireResolversForAllFields: false
            }
        })

        /*  establish the HAPI route for GraphQL  */
        let endpointMethod = "POST"
        let endpointURL    = this.$.path.graph
        this._.server.route({
            method: endpointMethod,
            path:   endpointURL,
            config: {
                auth:    { mode: "try", strategy: "jwt" },
                payload: { output: "data", parse: true, allow: "application/json" },
                plugins: {
                    websocket: {
                        only:          false,

                        /*  use framed communication  */
                        frame:         true,
                        frameEncoding: this.$.encoding,
                        frameRequest:  "GRAPHQL-REQUEST",
                        frameResponse: "GRAPHQL-RESPONSE",

                        /*  on WebSocket connection, establish subscription connection  */
                        connect: async ({ ctx, ws, wsf, req }) => {
                            let peer = this._.server.peer(req)
                            let cid = `${peer.addr}:${peer.port}`
                            let proto = `WebSocket/${ws.protocolVersion}+HTTP/${req.httpVersion}`
                            this.debug(1, `GraphQL: connect: peer=${cid}, method=${endpointMethod}, ` +
                                `url=${endpointURL}, protocol=${proto}`)
                            ctx.conn = this._.sub.connection(cid, (sids) => {
                                /*  send notification message about outdated subscriptions  */
                                this.debug(2, `GraphQL: notification: peer=${cid}, sids=${sids.join(",")}`)
                                try { wsf.send({ type: "GRAPHQL-NOTIFY", data: sids }) }
                                catch (ex) { void (ex) }
                            })
                            await this.hook("client-connect", "promise", { ctx, ws, wsf, req, peer })
                            this._.bus.publish("client-connections", +1)
                        },

                        /*  on WebSocket disconnection, destroy subscription connection  */
                        disconnect: async ({ ctx, ws, req }) => {
                            let peer = this._.server.peer(req)
                            let cid = `${peer.addr}:${peer.port}`
                            let proto = `WebSocket/${ws.protocolVersion}+HTTP/${req.httpVersion}`
                            await this.hook("client-disconnect", "promise", { ctx, ws, req, peer })
                            this._.bus.publish("client-connections", -1)
                            this.debug(1, `GraphQL: disconnect: peer=${cid}, method=${endpointMethod}, ` +
                                `url=${endpointURL}, protocol=${proto}`)
                            ctx.conn.destroy()
                        }
                    },
                    ducky: `{
                        query: string,
                        variables?: (object|string),
                        operationName?: (object|string)
                    }`
                }
            },
            handler: async (request, reply) => {
                /*  determine optional WebSocket information  */
                let ws = request.websocket()

                /*  short-circuit handler processing of initial WebSocket message
                    (instead we just want the authentication to be done by HAPI)  */
                if (ws.initially)
                    return reply().code(204)

                /*  load accounting  */
                await this.hook("client-request", "promise", { request, ws })
                this._.bus.publish("client-requests", +1)

                /*  determine request  */
                if (typeof request.payload !== "object" || request.payload === null)
                    return reply(Boom.badRequest("invalid request"))
                let query     = request.payload.query
                let variables = request.payload.variables
                let operation = request.payload.operationName

                /*  support special case of GraphiQL  */
                if (typeof variables === "string")
                    variables = JSON.parse(variables)
                if (typeof operation === "object" && operation !== null)
                    return reply(Boom.badRequest("invalid request"))

                /*  determine client id  */
                let peer = request.peer()
                let cid = `${peer.addr}:${peer.port}`

                /*  determine session information  */
                let { peerId, accountId, sessionId } = request.auth.credentials

                /*  create a scope for tracing GraphQL operations over WebSockets  */
                let scope = ws.mode === "websocket" ? ws.ctx.conn.scope(query, variables) : null

                /*  allow application to wrap execution into a (database) transaction  */
                let transaction = this.hook("graphql-transaction", "none")
                if (!transaction) {
                    transaction = (cb) => {
                        return new Promise((resolve, reject) => {
                            resolve(cb(null))
                        })
                    }
                }

                /*  execute GraphQL operation within a transaction  */
                return transaction(async (tx) => {
                    /*  create context for GraphQL resolver functions  */
                    let ctx = { tx, scope, peerId, accountId, sessionId }

                    /*  execute the GraphQL query against the GraphQL schema  */
                    let info = `peer=${cid}, query=${JSON.stringify(query)}`
                    if (variables) info += `, variables=${JSON.stringify(variables)}`
                    if (operation) info += `, operation=${JSON.stringify(operation)}`
                    this.debug(2, `GraphQL: request: ${info}`)
                    await this.hook("graphql-query", "promise", { schema: schemaExec, query, variables, operation, ctx })
                    return GraphQL.graphql(schemaExec, query, null, ctx, variables, operation)
                }).then(async (result) => {
                    /*  success/commit  */
                    if (scope)
                        scope.commit()
                    this.debug(2, `GraphQL: response (success): peer=${cid}, result=${JSON.stringify(result)}`)
                    await this.hook("graphql-result", "promise", { schema: schemaExec, query, variables, operation, result })
                    reply(result).code(200)
                }).catch(async (result) => {
                    /*  error/rollback  */
                    if (scope)
                        scope.reject()
                    this.debug(2, `GraphQL: response (error): peer=${cid}, result=${JSON.stringify(result)}`)
                    await this.hook("graphql-result", "promise", { schema: schemaExec, query, variables, operation, result })
                    reply(result)
                })
            }
        })
    }
    static async stop () {
        /*  stop timers  */
        if (this._timerLoad !== null) {
            clearTimeout(this._.timerLoad)
            this._timerLoad = null
        }
        if (this._timerConn !== null) {
            clearTimeout(this._.timerConn)
            this._timerConn = null
        }

        /*  close GraphQL subscribe mechanism  */
        await this._.sub.close()
        this._.sub = null

        /*  close IPC mechanisms  */
        await this._.kvs.close()
        this._.kvs = null
        await this._.bus.close()
        this._.bus = null
    }
}

