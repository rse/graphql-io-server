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
import Optioner          from "optioner"
import Joi               from "joi"

/*
import Axios             from "axios"
import UUID              from "pure-uuid"
import Ducky             from "ducky"
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
        let optioner = Optioner({
            url:         Joi.string().regex(/^https?:\/\/.+?:\d+\/.*$/).default("http://127.0.0.1:8080/api"),
            path: {
                login:   Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/login"),
                session: Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/session"),
                logout:  Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/logout"),
                graph:   Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/data/graph"),
                blob:    Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/data/blob")
            },
            encoding:    Joi.string().regex(/^(?:cbor|msgpack|json)$/).default("json"),
            debug:       Joi.number().integer().min(0).max(3).default(0)
        })
        optioner(options, (err, options) => {
            if (err)
                throw new Error(err)
            this._.options = options
        })

        /*  initialize internal state  */
        this._.xxx = null

        /*  provide latching sub-system  */
        this._.latching = new Latching()
    }

    /*  pass-through latching sub-system  */
    hook    (...args) { return this._.latching.hook(...args) }
    at      (...args) { return this._.latching.at(...args) }
    latch   (...args) { return this._.latching.latch(...args) }
    unlatch (...args) { return this._.latching.unlatch(...args) }

    /*  raise a fatal error  */
    error (err) {
        this.log(1, `ERROR: ${err}`)
        this.emit("error", err)
    }

    /*  raise a debug message  */
    log (level, msg) {
        if (level <= this._.options.debug) {
            let date = (new Date()).toISOString()
            let log = `${date} DEBUG [${level}]: ${msg}`
            this.emit("debug", { date, level, msg, log })
        }
    }
}

