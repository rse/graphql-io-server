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

/*  The GraphQL-IO Server API consists of the primary class Server.  */
declare module "graphql-io-server" {
    /*  The primary API class of GraphQL-IO Server,
     *  representing the network communication server.  */
    class Server {
        /*  Construct a new GraphQL-IO Server instance.  */
        public constructor(options?: {
            /*  The base URL of the server.
                Has to match the regex `^https?:\/\/.+?:\d+\/.*$`.
                The default is `"http://127.0.0.1:8080/api"`.  */
            url: string

            /*  The URL path section.  */
            path: {
                /*  The relative URL path to the login service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/login`.  */
                login: string,

                /*  The relative URL path to the session service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/session`.  */
                session: string,

                /*  The relative URL path to the logout service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/logout`.  */
                logout: string,

                /*  The relative URL path to the GraphQL service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/data/graph`.  */
                graph: string,

                /*  The relative URL path to the BLOB service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/data/blob`.  */
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
            called for every hook processing. Known hooks are: `login-credentials` (handler argument:
            `credentials: { username: string, password: string })`. Returns a function
            to remove the handler again. */
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

