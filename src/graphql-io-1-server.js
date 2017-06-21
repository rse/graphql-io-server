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

/*  external dependencies  */
import fs                from "mz/fs"
import Latching          from "latching"
import EventEmitter      from "eventemitter3"
import UUID              from "pure-uuid"
import Ducky             from "ducky"
import HAPI              from "hapi"
import http              from "http"
import Http2             from "http2"
import URI               from "urijs"
import Bluebird          from "bluebird"
import Inert             from "inert"
import HAPIAuth          from "hapi-auth-basic"
import HAPIBoom          from "hapi-boom-decorators"
import HAPIDucky         from "hapi-plugin-ducky"
import HAPIHeader        from "hapi-plugin-header"
import HAPIWebSocket     from "hapi-plugin-websocket"
import HAPICo            from "hapi-plugin-co"
import HAPITraffic       from "hapi-plugin-traffic"
import HAPIPeer          from "hapi-plugin-peer"
import generatePassword  from "generate-password"
import HAPIAuthJWT2      from "hapi-auth-jwt2"
import JWT               from "jsonwebtoken"

/*  internal dependencies  */
import UI                from "./graphql-io-2-ui"
import Auth              from "./graphql-io-3-auth"
import GraphQL           from "./graphql-io-4-graphql"
import BLOB              from "./graphql-io-5-blob"

/*  the exported API class  */
export default class Server extends EventEmitter {
    constructor (options) {
        super()

        /*  define internal state  */
        Object.defineProperty(this, "_", {
            configurable: false,
            enumerable:   false,
            writable:     false,
            value:        {}
        })

        /*  determine options  */
        this._.options = Ducky.options({
            name:        [ "string", "GraphQL-IO-Server" ],
            url:         [ "/^https?:\\/\\/.+?:\\d+\\/.*$/", "http://127.0.0.1:8080/api" ],
            path: {
                login:   [ "/^(?:|\\/.+)$/", "/auth/login" ],
                session: [ "/^(?:|\\/.+)$/", "/auth/session" ],
                logout:  [ "/^(?:|\\/.+)$/", "/auth/logout" ],
                graph:   [ "/^(?:|\\/.+)$/", "/data/graph" ],
                blob:    [ "/^(?:|\\/.+)$/", "/data/blob" ]
            },
            tls: {
                crt:     [ "string", "" ],
                key:     [ "string", "" ]
            },
            secret:      [ "string", generatePassword.generate({ length: 16, numbers: true }) ],
            ttl:         7 * 24 * 60 * 60 * 1000,
            frontend:    [ "string", "" ],
            graphiql:    [ "boolean", true ],
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            debug:       [ "number", 0 ]
        }, options)

        /*  initialize internal state  */
        this._.nsUUID = new UUID(5, "ns:URL", "http://graphql-io.com/ns/")
        this._.server = null

        /*  provide latching sub-system  */
        this._.latching = new Latching()
    }

    /*  INTERNAL: raise a fatal error  */
    error (err) {
        this.log(1, `ERROR: ${err}`)
        this.emit("error", err)
        return this
    }

    /*  INTERNAL: raise a debug message  */
    log (level, msg) {
        if (level <= this._.options.debug) {
            let date = (new Date()).toISOString()
            let log = `${date} DEBUG [${level}]: ${msg}`
            this.emit("debug", { date, level, msg, log })
        }
        return this
    }

    /*  pass-through latching sub-system  */
    at (...args) {
        this._.latching.latch(...args)
        return this
    }
    removeLatching (...args) {
        this._.latching.unlatch(...args)
        return this
    }

    /*  allow reconfiguration  */
    configure (options) {
        this._.options.merge(options)
        return this
    }

    /*  start the service  */
    async start () {
        /*  establish a new server context  */
        let server = new HAPI.Server()
        this._.server = server

        /*  create underlying HTTP/HTTPS listener  */
        let listener
        let withTLS = (this._.options.tls.crt !== "" && this._.options.tls.key !== "")
        if (withTLS) {
            let crt = await fs.readFile(this._.options.tls.crt, "utf8")
            let key = await fs.readFile(this._.options.tls.key, "utf8")
            listener = Http2.createServer({ key: key, cert: crt })
        }
        else
            listener = http.createServer()
        if (!listener.address)
            listener.address = function () { return this._server.address() }

        /*  configure the listening socket  */
        this._.url = URI.parse(this._.options.url)
        let hapiOpts = {
            listener: listener,
            address:  this._.url.host,
            port:     this._.url.port
        }
        if (withTLS)
            hapiOpts.tls = true
        server.connection(hapiOpts)

        /*  register HAPI plugins  */
        const register = Bluebird.promisify(server.register, { context: server })
        await register({ register: Inert })
        await register({ register: HAPIAuth })
        await register({ register: HAPIBoom })
        await register({ register: HAPIDucky })
        await register({ register: HAPIHeader, options: { Server: this._.options.name } })
        await register({ register: HAPIWebSocket })
        await register({ register: HAPICo })
        await register({ register: HAPITraffic })
        await register({ register: HAPIPeer })

        /*  provide client IP address  */
        server.ext("onRequest", (request, reply) => {
            let clientAddress = "<unknown>"
            if (request.headers["x-forwarded-for"])
                clientAddress = request.headers["x-forwarded-for"]
                    .replace(/^(\S+)(?:,\s*\S+)*$/, "$1")
            else
                clientAddress = request.info.remoteAddress
            request.app.clientAddress = clientAddress
            return reply.continue()
        })

        /*  prepare for JSONWebToken (JWT) authentication  */
        let jwtKey = this._.options.secret
        server.register(HAPIAuthJWT2, (err) => {
            if (err)
                throw new Error(err)
            server.auth.strategy("jwt", "jwt", {
                key:           jwtKey,
                verifyOptions: { algorithms: [ "HS256" ] },
                urlKey:        "token",
                cookieKey:     "token",
                tokenType:     "JWT",
                validateFunc: (decoded, request, callback) => {
                    let result = this._.latching.hook("hapi:jwt-validate", "pass",
                        { error: null, result: true }, decoded, request)
                    callback(result.error, result.result, decoded)
                }
            })
        })
        this._.jwtSign = (data, expires) =>
            JWT.sign(data, jwtKey, { algorithm: "HS256", expiresIn: expires || "365d" })

        /*  log all requests  */
        server.on("tail", (request) => {
            let traffic = request.traffic()
            let ws = request.websocket()
            let protocol =
                (ws.mode === "websocket" ? `WebSocket/${ws.ws.protocolVersion}+` : "") +
                `HTTP/${request.raw.req.httpVersion}`
            let msg =
                "request: " +
                "remote="   + `${request.app.clientAddress}:${request.info.remotePort}` + ", " +
                "method="   + request.method.toUpperCase() + ", " +
                "url="      + request.url.path + ", " +
                "protocol=" + protocol + ", " +
                "response=" + request.response.statusCode + ", " +
                "recv="     + traffic.recvPayload + "/" + traffic.recvRaw + ", " +
                "sent="     + traffic.sentPayload + "/" + traffic.sentRaw + ", " +
                "duration=" + traffic.timeDuration
            this._log(2, `HAPI: request: ${msg}`)
        })
        server.on("request-error", (request, err) => {
            if (err instanceof Error)
                this._log(2, `HAPI: request-error: ${err.message}`)
            else
                this._log(2, `HAPI: request-error: ${err}`)
        })
        server.on("log", (event, tags) => {
            if (tags.error) {
                let err = event.data
                if (err instanceof Error)
                    this._log(2, `HAPI: log: ${err.message}`)
                else
                    this._log(2, `HAPI: log: ${err}`)
            }
        })

        /*  display network interaction information  */
        const displayListenHint = ([ scheme, proto ]) => {
            let url = `${scheme}://${this._.url.host}:${this._.url.port}`
            this._log(2, `listen on ${url} (${proto})`)
        }
        displayListenHint(withTLS ? [ "https", "HTTP/{1.0,1.1,2.0} + SSL/TLS" ] : [ "http",  "HTTP/{1.0,1.1}" ])
        displayListenHint(withTLS ? [ "wss",   "WebSockets + SSL/TLS" ]         : [ "ws",    "WebSockets" ])

        /*  setup services  */
        UI.start.call(this)
        Auth.start.call(this)
        GraphQL.start.call(this)
        BLOB.start.call(this)

        /*  start the HAPI service  */
        return new Promise((resolve, reject) => {
            server.start((err) => {
                if (err) {
                    this._log(2, "ERROR: failed to start HAPI service")
                    reject(err)
                }
                else {
                    this._log(2, "OK: started HAPI service")
                    resolve()
                }
            })
        })
    }

    /*  stop the service  */
    stop () {
        /*   stop the HAPI service  */
        return new Promise((resolve /*, reject */) => {
            this._log(2, "gracefully stopping HAPI service")
            this._.server.root.stop({ timeout: 4 * 1000 }, () => {
                /*  teardown services  */
                UI.stop.call(this)
                Auth.stop.call(this)
                GraphQL.stop.call(this)
                BLOB.stop.call(this)
                this._.server = null
                resolve()
            })
        })
    }
}

