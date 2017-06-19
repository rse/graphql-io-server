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
import Latching          from "latching"
import EventEmitter      from "eventemitter3"
import UUID              from "pure-uuid"
import Ducky             from "ducky"

/*
import Axios             from "axios"
import * as GraphQL      from "graphql"
import * as GraphQLTools from "graphql-tools"
import GraphQLSequelize  from "graphql-tools-sequelize"
import GraphQLSubscribe  from "graphql-tools-subscribe"
import GraphQLTypes      from "graphql-tools-types"
import Sequelize         from "sequelize"
import HAPI              from "hapi"
import HAPIGraphiQL      from "hapi-plugin-graphiql"
import HAPIWebSocket     from "hapi-plugin-websocket"
import HAPIPeer          from "hapi-plugin-peer"
import Boom              from "boom"
*/

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
            url:         [ "/^https?:\\/\\/.+?:\\d+\\/.*$/", "http://127.0.0.1:8080/api" ],
            path: {
                login:   [ "/^(?:|\\/.+)$/", "/auth/login" ],
                session: [ "/^(?:|\\/.+)$/", "/auth/session" ],
                logout:  [ "/^(?:|\\/.+)$/", "/auth/logout" ],
                graph:   [ "/^(?:|\\/.+)$/", "/data/graph" ],
                blob:    [ "/^(?:|\\/.+)$/", "/data/blob" ]
            },
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            debug:       [ "number", 0 ]
        }, options)

        /*  initialize internal state  */
        this._.nsUUID = new UUID(5, "ns:URL", "http://engelschall.com/ns/graphql-io")
        this._.hapi   = null

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
}

