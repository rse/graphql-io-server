/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2019 Dr. Ralf S. Engelschall <rse@engelschall.com>
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

/*  The GraphQL-IO Server API consists of the primary class Server.  */
declare module "graphql-io-server" {
    /*  The primary API class of GraphQL-IO Server,
        representing the network communication server.  */
    class Server {
        /*  Construct a new GraphQL-IO Server instance.  */
        public constructor(options?: {
            /*  The base URL of the server.
                Has to match the regex `^https?:\/\/.+?:\d+$`.
                The default is `"http://127.0.0.1:8080"`.  */
            url: string

            /*  The URL path section.  */
            path: {
                /*  The relative URL path to the optional static frontend.
                    Has to match the regex `^\\/.*$`.
                    The default is `/`.  */
                frontend: string,

                /*  The relative URL path to the optional GraphiQL frontend.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api`.  */
                graphiql: string,

                /*  The relative URL path to the login service of the server.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api/auth/login`.  */
                login: string,

                /*  The relative URL path to the session service of the server.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api/auth/session`.  */
                session: string,

                /*  The relative URL path to the logout service of the server.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api/auth/logout`.  */
                logout: string,

                /*  The relative URL path to the GraphQL service of the server.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api/data/graph`.  */
                graph: string,

                /*  The relative URL path to the BLOB service of the server.
                    Has to match the regex `^\\/.+$`.
                    The default is `/api/data/blob`.  */
                blob: string
            }

            /*  The Transport Layer Security (TLS) section.  */
            tls: {
                /*  The TLS certificate file in PEM format.  */
                crt: string,

                /*  The TLS private key file in PEM format.  */
                key: string
            },

            /*  The internal secret for JSON Web Token (JWT) generation.
                The default is an auto-generated secret which changes on every service start.  */
            secret: string,

            /*  The optional path to a HTML5 SPA based User Interface (UI) frontend application
                which should be statically served to the client under the base URL.  */
            frontend: string

            /*  The frame encoding for the GraphQL over WebSocket communication.
                Has to be either `cbor` (maximum performance, binary),
                `msgpack` (maximum performance, binary) or `json` (less performance, text, human readable).
                The default is `cbor`.  */
            encoding: string

            /*  The debugging level.
                Has to be an integer between 0 (no debugging) and 3 (maximum debugging messages).
                The default is 0. The debugging messages are emitted as the event `debug`
                and can be received with `client.on("debug", (msg) => { ... })`.  */
            debug: number
        })

        /*  Listen to an event **eventName** and let the callback **handler** be asynchronously
            called for every emitted event. Known events are `debug` (handler argument:
            `info: { date: string, level: number, msg: string, log: string })`
            and `error` (handler argument: `error: Error`). Returns a function
            to remove the handler again. */
        public on(eventName: string, handler: (eventData: any) => void): () => void

        /*  Latch into a hook **hookName** and let the callback **handler** be synchronously
            called for every hook processing. Returns a function to remove the handler again.
            Known hooks are:
            - `server-configure`
              (processing type: "promise", handler argument:
              `server: GraphQLIOServer`)
            - `jwt-validate`
              (processing type: "pass", handler argument:
              `ctx: { error: null, result: true }, decoded: Object, request: Object`)
            - `server-start`
              (processing type: "promise", handler argument:
              `server: HAPIServer`)
            - `server-stop`
              (processing type: "promise", handler argument:
              `server: HAPIServer`)
            - `peer-recognize`
              (processing type: "promise", handler argument:
              `ctx: { error: null, peerId: String }`)
            - `account-authenticate`
              (processing type: "promise", handler argument:
              `ctx: { error: null, accountId: String, username: null, password: null }`)
            - `session-create`
              (processing type: "promise", handler argument:
              `ctx: { error: null, sessionId: null, accountId: String, peerId: String, ttl: Number }`)
            - `session-details`
              (processing type: "promise", handler argument:
              `ctx: { error: null, peerId: null|String, accounId: null|String, sessionId: null|String }`)
            - `session-destroy`
              (processing type: "promise", handler argument:
              `ctx: { error: null, sessionId: String }`)
            - `graphql-schema`
              (processing type: "concat", handler argument: none)
            - `graphql-resolver`
              (processing type: "concat", handler argument: `resolver: Object`)
            - `graphql-postproc-schema`
              (processing type: "pass", handler argument: `schema: String`)
            - `graphql-postproc-resolver`
              (processing type: "pass", handler argument: `resolver: Object`)
            - `graphql-postproc-schema-exec`
              (processing type: "pass", handler argument: `schema: Object`)
            - `client-connect`
              (processing type: "promise", handler argument:
              `ctx: { ctx: Object, ws: Object, wsf: Object, req: Object, peer: String }`)
            - `client-disconnect`
              (processing type: "promise", handler argument:
              `ctx: { ctx: Object, ws: Object, req: Object, peer: String }`)
            - `client-request`
              (processing type: "promise", handler argument:
              `ctx: { request: Object, ws: Object }`)
            - `graphql-transaction`
              (processing type: "pass", handler argument:
              `ctx: { schema: Object, query: String, variables: Object,
              operation: String, ctx: Object }`)
            - `graphql-query`
              (processing type: "promise", handler argument:
              `ctx: { schema: Object, query: String, variables: Object,
              operation: String, ctx: Object }`)
            - `graphql-response-success`
              (processing type: "pass", handler argument: `result: Object`)
            - `graphql-response-error`
              (processing type: "pass", handler argument: `result: Object`)
            - `graphql-result`
              (processing type: "promise", handler argument:
              `ctx: { schema: Object, query: String, variables: Object,
              operation: String, result: Object }`)
            - `blob`
              (processing type: "promise", handler argument:
              `ctx: { error: null, path: String, filename: null, type: null, content: null,
              request: Object, peerId: String, accountId: String, sessionId: String }`)  */
        public at(hookName: string, handler: (...args: any[]) => any): () => void

        /*  Merge one or more options into the Server configuration.
            This accepts the same **options** as the constructor.
            Should be used before any call to connect().  */
        public set(options: object): Server

        /*  Initiate a start of the server.
            This instanciates the internal network connections.  */
        public start(): Promise<Server>

        /*  Initiate a stop of the server.
            This drops the internal network connections.  */
        public stop(): Promise<Server>
    }

    const server: Server
    export = server
}

