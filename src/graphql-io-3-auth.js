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
import UUID from "pure-uuid"

/*  Authentication functionality  */
export default class Auth {
    static async start () {
        /*  provide (implicit) (auto-)login mechanism  */
        this._.server.ext("onPostAuth", async (request, reply) => {
            if (request.auth.mode === "try" && !request.auth.isAuthenticated) {
                /*  recognize peer by id  */
                let { id: peerId } = request.peer()
                let ctx = { error: null, peerId }
                await this.hook("peer-recognize", "promise", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to handle peer: ${ctx.error}`)
                peerId = ctx.peerId

                /*  authenticate account via username/password  */
                ctx = { error: null, accountId: null, username: null, password: null }
                await this.hook("account-authenticate", "promise", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to authenticate username/password: ${ctx.error}`)
                let accountId = ctx.accountId
                if (accountId === null)
                    accountId = "anonymous"

                /*  create new session  */
                ctx = { error: null, sessionId: null, accountId, peerId, ttl: this.$.ttl }
                await this.hook("session-create", "promise", ctx)
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

                /*  provide token as a cookie  */
                reply.state(`${this.$.prefix}Token`, jwt, {
                    ttl:          this.$.ttl,
                    path:         this._.prefix,
                    encoding:     "none",
                    isHttpOnly:   true,
                    isSecure:     false,
                    clearInvalid: false,
                    strictHeader: true
                })

                /*  provide implicit authentication information  */
                request.auth.isAuthenticated = true
                request.auth.strategy        = "jwt"
                request.auth.credentials     = { peerId, accountId, sessionId }
                request.auth.error           = null
            }
            reply.continue()
        })

        /*  provide (explicit) login endpoint  */
        this._.server.route({
            method: "POST",
            path:   this.$.path.login,
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
                await this.hook("peer-recognize", "promise", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to handle peer: ${ctx.error}`)
                peerId = ctx.peerId

                /*  authenticate account via username/password  */
                ctx = { error: null, accountId: null, username, password }
                await this.hook("account-authenticate", "promise", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to authenticate username/password: ${ctx.error}`)
                let accountId = ctx.accountId
                if (accountId === null)
                    accountId = "anonymous"

                /*  create new session  */
                ctx = { error: null, sessionId: null, accountId, peerId, ttl: this.$.ttl }
                await this.hook("session-create", "promise", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to create new session: ${ctx.error}`)
                let sessionId = ctx.sessionId
                if (sessionId === null)
                    sessionId = (new UUID(1)).format()

                /*  log request  */
                let peer = request.peer()
                let cid = `${peer.addr}:${peer.port}`
                this.debug(1, `Auth: login: peer=${cid}, username=${username}, ` +
                    `peerId=${peerId}, accountId=${accountId}, sessionId=${sessionId}`)

                /*  issue new token  */
                let jwt = this._.jwtSign({
                    peerId:    peerId,
                    accountId: accountId,
                    sessionId: sessionId
                }, "365d")

                /*  send token and peer information in payload and cookie  */
                let payload = { token: jwt, peer: peerId }
                reply(payload).code(201).state(`${this.$.prefix}Token`, jwt, {
                    ttl:          this.$.ttl,
                    path:         this._.prefix,
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
            path:   this.$.path.session,
            config: {
                auth: { mode: "try", strategy: "jwt" }
            },
            handler: async (request, reply) => {
                /*  log request  */
                let peer = request.peer()
                let cid = `${peer.addr}:${peer.port}`
                this.debug(1, `Auth: session: peer=${cid}`)

                /*  fetch credentials  */
                let ctx = {
                    error:     null,
                    peerId:    null,
                    accountId: null,
                    sessionId: null
                }
                if (request.auth.isAuthenticated) {
                    ctx.peerId    = request.auth.credentials.peerId
                    ctx.accountId = request.auth.credentials.accountId
                    ctx.sessionId = request.auth.credentials.sessionId
                }
                await this.hook("session-details", "promise", ctx)
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
            path:   this.$.path.logout,
            config: {
                auth: false
            },
            handler: async (request, reply) => {
                /*  log request  */
                let peer = request.peer()
                let cid = `${peer.addr}:${peer.port}`
                this.debug(1, `Auth: logout: peer=${cid}`)

                /*  destroy session  */
                if (   request.auth.isAuthenticated
                    && typeof request.auth.credentials === "object"
                    && request.auth.credentials !== null) {
                    let { sessionId } = request.auth.credentials
                    let ctx = { error: null, sessionId }
                    await this.hook("session-destroy", "promise", ctx)
                    if (ctx.error !== null)
                        return reply.unauthorized(`failed to logout: ${ctx.error}`)
                }

                /*  destroy cookie  */
                reply().code(204).state(`${this.$.prefix}Token`, "", {
                    ttl:          0,
                    path:         this._.prefix,
                    encoding:     "none",
                    isHttpOnly:   true,
                    isSecure:     false,
                    clearInvalid: false,
                    strictHeader: true
                })
            }
        })
    }
    static async stop () {
    }
}
