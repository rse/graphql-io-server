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
import Boom from "boom"

/*  the Binary Large OBject (BLOB) delivery  */
export default class BLOB {
    static start () {
        /*  optional delivery of BLOB data  */
        if (this._.options.frontend !== "") {
            this._.server.route({
                method: "GET",
                path: `${this._.options.path.blob}/{path*}`,
                handler: (request, reply) => {
                    let { path, filename, type, content } = this._.latching.hook("blob", request.params.path)
                    if (path !== null)
                        /*  stream content from filesystem  */
                        return reply.file(path, {
                            confine:  false,
                            filename: filename ? filename : path,
                            mode:     "attachment"
                        }).code(200)
                    else if (content !== null) {
                        /*  send content from memory  */
                        let response = reply(content).code(200)
                        response.type(type ? type : "application/octet-stream")
                        if (filename)
                            response.header("content-disposition",
                                "attachment; filename=" + encodeURIComponent(filename))
                        return response
                    }
                    else
                        reply(Boom.internal("neither path nor content given by application"))
                }
            })
        }
    }
    static stop () {
        /* FIXME */
    }
}

