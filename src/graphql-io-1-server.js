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

/*  external dependencies  */
import fs                from "mz/fs"
import StdAPI            from "stdapi"
import UUID              from "pure-uuid"
import HAPI              from "hapi"
import http              from "http"
import Http2             from "http2"
import URI               from "urijs"
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
import commonPathPrefix  from "common-path-prefix"

/*  internal dependencies  */
import UI                from "./graphql-io-2-ui"
import Auth              from "./graphql-io-3-auth"
import GraphQL           from "./graphql-io-4-graphql"
import BLOB              from "./graphql-io-5-blob"

/*  the exported API class  */
export default class Server extends StdAPI {
    constructor (options) {
        super(options, {
            prefix:       [ "string", "GraphQL-IO-" ],
            name:         [ "string", "GraphQL-IO-Server" ],
            url:          [ "/^https?:\\/\\/.+?(?::\\d+)?$/", "http://127.0.0.1:8080" ],
            path: {
                frontend: [ "/^\\/.*$/", "/" ],
                graphiql: [ "/^\\/.+$/", "/api" ],
                login:    [ "/^\\/.+$/", "/api/auth/login" ],
                session:  [ "/^\\/.+$/", "/api/auth/session" ],
                logout:   [ "/^\\/.+$/", "/api/auth/logout" ],
                graph:    [ "/^\\/.+$/", "/api/data/graph" ],
                blob:     [ "/^\\/.+$/", "/api/data/blob" ]
            },
            tls: {
                crt:      [ "string", "" ],
                key:      [ "string", "" ]
            },
            secret:       [ "string", generatePassword.generate({ length: 16, numbers: true }) ],
            ttl:          [ "number", 7 * 24 * 60 * 60 * 1000 ],
            pubsub:       [ "string", "spm" ],
            keyval:       [ "string", "spm" ],
            frontend:     [ "string", "" ],
            graphiql:     [ "boolean", true ],
            encoding:     [ "/^(?:cbor|msgpack|json)$/", "json" ],
            debug:        [ "number", 0 ],
            example:      [ "string",
                "query Example {\n" +
                "    session {\n" +
                "        peerId accountId sessionId\n" +
                "    }\n" +
                "}\n"
            ]
        })

        /*  initialize internal state  */
        this._.nsUUID = new UUID(5, "ns:URL", "http://graphql-io.com/ns/")
        this._.server = null
        this._.prefix = null
    }

    /*  start the service  */
    async start () {
        /*  give others still a chance to reconfigure us  */
        await this.hook("server-configure", "promise", this)

        /*  determine common URL path prefix  */
        this._.prefix = commonPathPrefix([
            this.$.path.login,
            this.$.path.session,
            this.$.path.logout,
            this.$.path.graph,
            this.$.path.blob
        ], "/")
        if (this._.prefix === "")
            this._.prefix = "/"

        /*  parse the URL  */
        this._.url = URI.parse(this.$.url)
        if (this._.url.port === null)
            this._.url.port = this._.url.protocol === "https" ? 443 : 80
        if (typeof this._.url.port === "string")
            this._.url.port = parseInt(this._.url.port)
        let withTLS = (this.$.tls.crt !== "" && this.$.tls.key !== "")
        if (!withTLS && this._.url.protocol === "https")
            throw new Error("HTTPS requires TLS Certificate/Key")

        /*  create underlying HTTP/HTTPS listener  */
        let listener
        if (withTLS) {
            let crt = await fs.readFile(this.$.tls.crt, "utf8")
            let key = await fs.readFile(this.$.tls.key, "utf8")
            listener = Http2.createServer({ key: key, cert: crt })
        }
        else
            listener = http.createServer()
        if (!listener.address)
            listener.address = function () { return this._server.address() }

        /*  configure the listening socket  */
        let hapiOpts = {
            listener:   listener,
            autoListen: false
        }
        if (withTLS)
            hapiOpts.tls = true

        /*  establish a new server context  */
        let server = new HAPI.Server(hapiOpts)
        this._.server = server

        /*  start listening  */
        listener.listen(this._.url.port, this._.url.hostname)
        this._.listener = listener

        /*  register HAPI plugins  */
        await server.register({ plugin: Inert })
        await server.register({ plugin: HAPIAuth })
        await server.register({ plugin: HAPIBoom })
        await server.register({ plugin: HAPIDucky })
        await server.register({ plugin: HAPIHeader, options: {
            Server: this.$.name
        }})
        await server.register({ plugin: HAPIWebSocket })
        await server.register({ plugin: HAPICo })
        await server.register({ plugin: HAPITraffic })
        await server.register({ plugin: HAPIPeer, options: {
            peerId: true,
            cookieName: `${this.$.prefix}Peer`,
            cookieOptions: {
                path: this._.prefix,
                isSameSite: "Strict"
            }
        }})

        /*  provide client IP address  */
        server.ext("onRequest", async (request, h) => {
            let clientAddress = "<unknown>"
            if (request.headers["x-forwarded-for"])
                clientAddress = request.headers["x-forwarded-for"]
                    .replace(/^(\S+)(?:,\s*\S+)*$/, "$1")
            else
                clientAddress = request.info.remoteAddress
            request.app.clientAddress = clientAddress
            return h.continue
        })

        /*  prepare for JSONWebToken (JWT) authentication  */
        let jwtKey = this.$.secret
        await server.register({ plugin: HAPIAuthJWT2 })
        server.auth.strategy("jwt", "jwt", {
            key:           jwtKey,
            verifyOptions: { algorithms: [ "HS256" ] },
            urlKey:        `${this.$.prefix}Token`,
            cookieKey:     `${this.$.prefix}Token`,
            tokenType:     "JWT",
            validate: (decoded, request, h) => {
                let result = this.hook("jwt-validate", "pass",
                    { error: null, result: true }, decoded, request)
                return { isValid: result.result, error: result.error }
            }
        })
        this._.jwtSign = (data, expires) =>
            JWT.sign(data, jwtKey, { algorithm: "HS256", expiresIn: expires || "365d" })

        /*  log all requests  */
        server.events.on("response", (request) => {
            let traffic = request.traffic()
            let protocol = `HTTP/${request.raw.req.httpVersion}`
            let ws = request.websocket()
            if (ws.mode === "websocket") {
                let wsVersion = ws.ws.protocolVersion || request.headers["sec-websocket-version"] || "13?"
                protocol = `WebSocket/${wsVersion}+${protocol}`
            }
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
            this.debug(2, `HAPI: request: ${msg}`)
        })
        server.events.on({ name: "request", channels: [ "error" ] }, (request, event, tags) => {
            if (event.error instanceof Error)
                this.debug(2, `HAPI: request-error: ${event.error.message}`)
            else
                this.debug(2, `HAPI: request-error: ${event.error}`)
        })
        server.events.on("log", (event, tags) => {
            if (tags.error) {
                let err = event.data
                if (err instanceof Error)
                    this.debug(2, `HAPI: log: ${err.message}`)
                else
                    this.debug(2, `HAPI: log: ${err}`)
            }
        })

        /*  display network interaction information  */
        const displayListenHint = ([ scheme, proto ]) => {
            let url = `${scheme}://${this._.url.hostname}:${this._.url.port}`
            this.debug(2, `listen on ${url} (${proto})`)
        }
        displayListenHint(withTLS ? [ "https", "HTTP/{1.0,1.1,2.0} + SSL/TLS" ] : [ "http",  "HTTP/{1.0,1.1}" ])
        displayListenHint(withTLS ? [ "wss",   "WebSockets + SSL/TLS" ]         : [ "ws",    "WebSockets" ])

        /*  setup services  */
        await UI.start.call(this)
        await Auth.start.call(this)
        await GraphQL.start.call(this)
        await BLOB.start.call(this)

        /*  allow application to hook into  */
        await this.hook("server-start", "promise", server)

        /*  start the HAPI service  */
        return new Promise((resolve, reject) => {
            server.start().then(() => {
                this.debug(2, "OK: started HAPI service")
                resolve()
            }).catch((err) => {
                this.debug(2, "ERROR: failed to start HAPI service")
                reject(err)
            })
        })
    }

    /*  stop the service  */
    async stop () {
        /*   stop the HAPI service  */
        this.debug(2, "gracefully stopping HAPI service")
        await this._.server.stop({ timeout: 4 * 1000 })

        /*  allow application to hook into  */
        await this.hook("server-stop", "promise", this._.server)

        /*  teardown services  */
        await BLOB.stop.call(this)
        await GraphQL.stop.call(this)
        await Auth.stop.call(this)
        await UI.stop.call(this)

        /*  stop listening  */
        this._.listener.close()

        /*  finally destroy HAPI instance  */
        this._.server = null
    }
}
