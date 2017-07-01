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
import HAPIGraphiQL from "hapi-plugin-graphiql"

/*  static delivery of User Interfaces  */
export default class UI {
    static start () {
        /*  optional static delivery of specific application UI
            (works at top-level because HAPI route are matched most-specific)  */
        if (this.$.frontend !== "") {
            this._.server.route({
                method: "GET",
                path: `${this._.url.path}/{path*}`,
                handler: {
                    directory: {
                        path:  this.$.frontend,
                        index: true,
                        listing: false,
                        showHidden: false,
                        redirectToSlash: true,
                        etagMethod: "hash",
                        lookupCompressed: true,
                        lookupMap: { "gzip": ".gz", "br": ".br" }
                    }
                }
            })
        }

        /*  optional static delivery of generic GraphiQL UI
            (works at same path as GraphQL as it is GET based)  */
        if (this.$.graphiql) {
            this._.server.register({
                register: HAPIGraphiQL,
                options: {
                    graphiqlURL:     this._.url.path,
                    graphqlFetchURL: `${this._.url.path}${this.$.path.graph}`,
                    graphqlFetchOpts: `{
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept":       "application/json"
                        },
                        body: JSON.stringify(params),
                        credentials: "same-origin"
                    }`,
                    loginFetchURL: `${this._.url.path}${this.$.path.login}`,
                    loginFetchOpts: `{
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            username: username,
                            password: password
                        }),
                        credentials: "same-origin"
                    }`,
                    graphqlExample: this.$.example
                }
            })
        }
    }
    static stop () {
    }
}

