/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2017 Ralf S. Engelschall <rse@engelschall.com>
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

/*  standard requirements  */
import cluster           from "cluster"

/*  external requirements  */
import * as GraphQL      from "graphql"
import * as GraphQLTools from "graphql-tools"
import GraphQLTypes      from "graphql-tools-types"
import GraphQLSubscribe  from "graphql-tools-subscribe"
import Boom              from "boom"
import textframe         from "textframe"
import PubSub            from "ipc-pubsub"

/*  internal requirements  */
import pkg               from "../package.json"

/*  the GraphQL functionality  */
export default class GraphQLService {
    static async start () {
        /*  setup IPC communication bus  */
        let bus = new PubSub(this.$.pubsub)
        await bus.open()

        /*  bootstrap GraphQL subscription framework  */
        let sub = new GraphQLSubscribe({
            pubsub: this.$.pubsub,
            keyval: this.$.keyval
        })

        /*  start with a mininum GraphQL schema and resolver  */
        let schema = `
            schema {
                query:    Root
                mutation: Root
            }
            type Root {
            }
        `
        let resolver = {
            Root: {}
        }

        /*  let application extend GraphQL schema and resolver  */
        let apiSchema   = this.hook("graphql-schema",   "concat")
        let apiResolver = this.hook("graphql-resolver", "concat")

        /*  extend schema  */
        apiSchema.forEach((api) => {
            schema += textframe(api)
        })

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
        mixinSchema("Root", "Server: Server")
        mixinSchema("root", `
            #   Information about GraphQL-IO Server
            type Server {
                #   name of GraphQL-IO Server
                name:    String
                #   version of GraphQL-IO Server
                version: String
                #   load average within last 5 seconds in request/second
                load5s:  Float
                #   load average within last 1 minute in request/second
                load1m:  Float
                #   load average within last 5 minutes in request/second
                load5m:  Float
                #   load average within last 15 minutes in request/second
                load15m: Float
                #   number of currently connected clients
                clients: Int
            }
        `)
        let server = {
            name:    pkg.name,
            version: pkg.version,
            load5s:  0.0,
            load1m:  0.0,
            load5m:  0.0,
            load15m: 0.0,
            clients: 0
        }
        mixinResolver("Root", "Server", (obj, args, ctx, info) => {
            ctx.scope.record("Server", 0, "read", "direct", "one")
            return server
        })

        /*  perform load accounting  */
        let processes = 1
        if (cluster.isMaster) {
            cluster.on("exit", () => { processes-- })
            cluster.on("fork", () => { processes++ })
        }
        let requestsWithinUnit = 0
        let requestsWithinUnitForLoad10 = 5 /* sec */ * 1 /* requests/sec  */
        let loadAccountUnit = 5 * 1000
        let loadAvg1  = []
        let loadAvg5  = []
        let loadAvg15 = []
        setInterval(() => {
            let modified = false

            /*  calculate load average over last 5 seconds  */
            let load = requestsWithinUnit
            load = (load / (requestsWithinUnitForLoad10 * processes)) * 1.0
            load = Math.trunc(load * 100) / 100
            if (server.load5s !== load) {
                server.load5s = load
                modified = true
            }

            /*  calculate load average over last 1 minute  */
            loadAvg1.push(requestsWithinUnit)
            if (loadAvg1.length > 1 * ((60 * 1000) / loadAccountUnit))
                loadAvg1.shift()
            load = loadAvg1.reduce((sum, val) => sum + val, 0) / loadAvg1.length
            load = (load / (requestsWithinUnitForLoad10 * processes)) * 1.0
            load = Math.trunc(load * 100) / 100
            if (server.load1m !== load) {
                server.load1m = load
                modified = true
            }

            /*  calculate load average over last 5 minutes  */
            loadAvg5.push(requestsWithinUnit)
            if (loadAvg5.length > 5 * ((60 * 1000) / loadAccountUnit))
                loadAvg5.shift()
            load = loadAvg5.reduce((sum, val) => sum + val, 0) / loadAvg5.length
            load = (load / (requestsWithinUnitForLoad10 * processes)) * 1.0
            load = Math.trunc(load * 100) / 100
            if (server.load5m !== load) {
                server.load5m = load
                modified = true
            }

            /*  calculate load average over last 15 minutes  */
            loadAvg15.push(requestsWithinUnit)
            if (loadAvg15.length > 15 * ((60 * 1000) / loadAccountUnit))
                loadAvg15.shift()
            load = loadAvg15.reduce((sum, val) => sum + val, 0) / loadAvg15.length
            load = (load / (requestsWithinUnitForLoad10 * processes)) * 1.0
            load = Math.trunc(load * 100) / 100
            if (server.load15m !== load) {
                server.load15m = load
                modified = true
            }

            /*  reset requests within unit  */
            requestsWithinUnit = 0

            /*  on any changes to the server object, record the change  */
            if (modified)
                sub.scopeRecord("Server", 0, "update", "direct", "one")
        }, loadAccountUnit)
        bus.subscribe("client-requests", (num) => {
            requestsWithinUnit++
        })
        bus.subscribe("client-connections", (num) => {
            server.clients += num
            if (server.clients < 0)
                server.clients = 0
            sub.scopeRecord("Server", 0, "update", "direct", "one")
        })

        /*  mixin GraphQL subscription into schema and resolver  */
        mixinSchema("Root",         sub.schemaSubscription())
        mixinSchema("root",         "type Subscription {}")
        mixinSchema("Subscription", sub.schemaSubscriptions())
        mixinSchema("Subscription", sub.schemaSubscribe())
        mixinSchema("Subscription", sub.schemaUnsubscribe())
        mixinSchema("Subscription", sub.schemaPause())
        mixinSchema("Subscription", sub.schemaResume())
        mixinResolver("Root",         "Subscription",  sub.resolverSubscription())
        mixinResolver("Subscription", "subscriptions", sub.resolverSubscriptions())
        mixinResolver("Subscription", "subscribe",     sub.resolverSubscribe())
        mixinResolver("Subscription", "unsubscribe",   sub.resolverUnsubscribe())
        mixinResolver("Subscription", "pause",         sub.resolverPause())
        mixinResolver("Subscription", "resume",        sub.resolverResume())

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
        let endpointURL    = `${this._.url.path}${this.$.path.graph}`
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
                        connect: ({ ctx, ws, wsf, req }) => {
                            let peer = this._.server.peer(req)
                            let cid = `${peer.addr}:${peer.port}`
                            let proto = `WebSocket/${ws.protocolVersion}+HTTP/${req.httpVersion}`
                            this.debug(1, `connect: peer=${cid}, method=${endpointMethod}, ` +
                                `url=${endpointURL}, protocol=${proto}`)
                            ctx.conn = sub.connection(cid, (sids) => {
                                /*  send notification message about outdated subscriptions  */
                                this.debug(2, `sending GraphQL notification for SID(s): ${sids.join(", ")}`)
                                try { wsf.send({ type: "GRAPHQL-NOTIFY", data: sids }) }
                                catch (ex) { void (ex) }
                            })
                            bus.publish("client-connections", +1)
                        },

                        /*  on WebSocket disconnection, destroy subscription connection  */
                        disconnect: ({ ctx, ws, req }) => {
                            let peer = this._.server.peer(req)
                            let cid = `${peer.addr}:${peer.port}`
                            let proto = `WebSocket/${ws.protocolVersion}+HTTP/${req.httpVersion}`
                            bus.publish("client-connections", -1)
                            this.debug(1, `disconnect: peer=${cid}, method=${endpointMethod}, ` +
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
            handler: (request, reply) => {
                /*  determine optional WebSocket information  */
                let ws = request.websocket()

                /*  short-circuit handler processing of initial WebSocket message
                    (instead we just want the authentication to be done by HAPI)  */
                if (ws.initially)
                    return reply().code(204)

                /*  load accounting  */
                bus.publish("client-requests", +1)

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

                /*  determine session information  */
                let { peerId, accountId, sessionId } = request.auth.credentials

                /*  create a scope for tracing GraphQL operations over WebSockets  */
                let scope = ws.mode === "websocket" ? ws.ctx.conn.scope(query) : null

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
                return transaction((tx) => {
                    /*  create context for GraphQL resolver functions  */
                    let ctx = { tx, scope, peerId, accountId, sessionId }

                    /*  execute the GraphQL query against the GraphQL schema  */
                    return GraphQL.graphql(schemaExec, query, null, ctx, variables, operation)
                }).then((result) => {
                    /*  success/commit  */
                    if (scope)
                        scope.commit()
                    reply(result).code(200)
                }).catch((result) => {
                    /*  error/rollback  */
                    if (scope)
                        scope.reject()
                    reply(result)
                })
            }
        })
    }
    static async stop () {
        /* FIXME */
    }
}

