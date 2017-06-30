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
                    ducky: "{ deviceId: string, username?: string, password?: string }"
                }
            },
            handler: async (request, reply) => {
                /*  fetch payload  */
                let { deviceId, username, password } = request.payload

                /*  check device  */
                let ctx = { error: null, deviceId }
                await this._.latching.hook("device-for-credentials", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to authenticate device: ${ctx.error}`)
                deviceId = ctx.deviceId
                if (deviceId === null)
                    deviceId = "unknown"

                /*  check username/password  */
                ctx = { error: null, accountId: null, username, password }
                await this._.latching.hook("account-for-credentials", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to authenticate username/password: ${ctx.error}`)
                let accountId = ctx.accountId
                if (accountId === null)
                    accountId = "anonymous"

                /*  create new session  */
                ctx = { error: null, sessionId: null, accountId, ttl: this._.options.ttl }
                await this._.latching.hook("session-for-account", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to create new session: ${ctx.error}`)
                let sessionId = ctx.sessionId
                if (sessionId === null)
                    sessionId = (new UUID(1)).format()

                /*  issue new token  */
                let jwt = this._.jwtSign({
                    sessionId: sessionId,
                    accountId: accountId,
                    deviceId:  deviceId
                }, "365d")

                /*  send token in payload and cookie  */
                reply({ token: jwt }).code(201).state("token", jwt, {
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
                    error: null,
                    sessionId: request.auth.credentials.sessionId,
                    accountId: request.auth.credentials.accountId,
                    deviceId:  request.auth.credentials.deviceId
                }
                await this._.latching.hook("session-details", "none", ctx)
                if (ctx.error !== null)
                    return reply.unauthorized(`failed to determine session: ${ctx.error}`)
                let { deviceId, sessionId, accountId } = ctx

                /*  pass-through information  */
                reply({
                    sessionId: sessionId,
                    accountId: accountId,
                    deviceId:  deviceId
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
