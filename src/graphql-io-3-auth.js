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

/*  external requirements  */
import UUID from "pure-uuid"

/*  Authentication functionality  */
export default class Auth {
    static start () {
        /*  provide login endpoint  */
        this._.server.route({
            method: "POST",
            path:   `${this._.url.path}${this._.options.path.login}`,
            config: {
                auth:     false,
                payload:  { output: "data", parse: true, allow: "application/json" },
                plugins: {
                    ducky: "{ username?: string, password?: string }"
                }
            },
            handler: async (request, reply) => {
                /*  fetch payload  */
                let { username, password } = request.payload

                /*  recognize peer by id  */
                let { id: peerId } = request.peer()
                let ctx = { error: null, peerId }
                await this._.latching.hook("peer-recognize", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to handle peer: ${ctx.error}`)
                peerId = ctx.peerId

                /*  authenticate account via username/password  */
                ctx = { error: null, accountId: null, username, password }
                await this._.latching.hook("account-authenticate", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to authenticate username/password: ${ctx.error}`)
                let accountId = ctx.accountId
                if (accountId === null)
                    accountId = "anonymous"

                /*  create new session  */
                ctx = { error: null, sessionId: null, accountId, peerId, ttl: this._.options.ttl }
                await this._.latching.hook("session-create", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to create new session: ${ctx.error}`)
                let sessionId = ctx.sessionId
                if (sessionId === null)
                    sessionId = (new UUID(1)).format()

                /*  issue new token  */
                let jwt = this._.jwtSign({
                    peerId:    peerId,
                    accountId: accountId,
                    sessionId: sessionId
                }, "365d")

                /*  send token and peer information in payload and cookie  */
                let payload = { token: jwt, peer: peerId }
                reply(payload).code(201).state(`${this._.options.prefix}Token`, jwt, {
                    ttl:          this._.options.ttl,
                    path:         this._.url.path,
                    encoding:     "none",
                    isHttpOnly:   true,
                    isSecure:     false,
                    clearInvalid: false,
                    strictHeader: true
                })
            }
        })

        /*  provide session detail gathering endpoint  */
        this._.server.route({
            method: "GET",
            path:   `${this._.url.path}${this._.options.path.session}`,
            config: {
                auth: { mode: "try", strategy: "jwt" }
            },
            handler: async (request, reply) => {
                /*  fetch credentials  */
                let ctx = {
                    error:     null,
                    peerId:    request.auth.credentials.peerId,
                    accountId: request.auth.credentials.accountId,
                    sessionId: request.auth.credentials.sessionId
                }
                await this._.latching.hook("session-details", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to determine session: ${ctx.error}`)
                let { peerId, accountId, sessionId } = ctx

                /*  pass-through information  */
                reply({
                    peerId:    peerId,
                    accountId: accountId,
                    sessionId: sessionId
                }).code(200)
            }
        })

        /*  provide logout endpoint  */
        this._.server.route({
            method: "GET",
            path:   `${this._.url.path}${this._.options.path.logout}`,
            config: {
                auth: false
            },
            handler: async (request, reply) => {
                /*  destroy session  */
                if (request.auth.credentials !== null) {
                    let { sessionId } = request.auth.credentials
                    let ctx = { error: null, sessionId }
                    await this._.latching.hook("session-destroy", "none", ctx)
                    if (ctx.error !== null)
                        return reply.unauthorized(`failed to logout: ${ctx.error}`)
                }

                /*  destroy cookie  */
                reply().code(204).state("token", "", {
                    ttl:          0,
                    path:         this._.url.path,
                    encoding:     "none",
                    isHttpOnly:   true,
                    clearInvalid: false,
                    strictHeader: true
                })
            }
        })
    }
    static stop () {
    }
}
