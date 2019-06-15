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

/*  external requirements  */
import Boom from "boom"

/*  the Binary Large OBject (BLOB) delivery  */
export default class BLOB {
    static async start () {
        /*  optional delivery of BLOB data  */
        if (this.$.frontend !== "") {
            this._.server.route({
                method: "GET",
                path: `${this.$.path.blob}/{path*}`,
                options: {
                    auth: { mode: "try", strategy: "jwt" }
                },
                handler: async (request, h) => {
                    let { peerId, accountId, sessionId } = request.auth.credentials
                    let ctx = {
                        error:    null,
                        path:     request.params.path,
                        filename: null,
                        type:     null,
                        content:  null,
                        request,
                        peerId,
                        accountId,
                        sessionId
                    }
                    await this.hook("blob", "promise", ctx)
                    if (ctx.error !== null)
                        return Boom.unauthorized(`failed to determine BLOB information: ${ctx.error}`)
                    if (ctx.path !== null) {
                        /*  stream content from filesystem  */
                        let response = h.file(ctx.path, {
                            confine:  false,
                            filename: ctx.filename !== null ? ctx.filename : ctx.path,
                            mode:     "attachment"
                        })
                        response.code(200)
                        if (ctx.type !== null)
                            response.type(ctx.type)
                        return response
                    }
                    else if (ctx.content !== null) {
                        /*  send content from memory  */
                        let response = h.response(ctx.content)
                        response.code(200)
                        response.type(ctx.type !== null ? ctx.type : "application/octet-stream")
                        if (ctx.filename)
                            response.header("content-disposition",
                                "attachment; filename=" + encodeURIComponent(ctx.filename))
                        return response
                    }
                    else
                        return Boom.internal("neither path nor content given by application")
                }
            })
        }
    }
    static async stop () {
    }
}

