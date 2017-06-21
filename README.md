
[GraphQL-IO-Meta](https://github.com/rse/graphql-io) &nbsp;|&nbsp;
[GraphQL-IO-Client](https://github.com/rse/graphql-io-client) &nbsp;|&nbsp;
[GraphQL-IO-Server](https://github.com/rse/graphql-io-server)

<img src="https://rawgit.com/rse/graphql-io/master/graphql-io.svg" width="250" align="right" alt=""/>

GraphQL-IO-Server
=================

[HERE BE DRAGONS -- STILL WORK IN PROGRESS -- EARLY ADOPTERS ONLY]

GraphQL Network Communication Framework (Server)

<p/>
<img src="https://nodei.co/npm/graphql-io-server.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/graphql-io-server.png" alt=""/>

About
-----

This is a [GraphQL](http://graphql.org/) network communication framework for
JavaScript servers, running under Node.js.
It is based on the GraphQL engine [GraphQL.js](http://graphql.org/graphql-js/),
the GraphQL schema execution library [GraphQL-Tools](http://dev.apollodata.com/tools/graphql-tools/),
the GraphQL type definition library [GraphQL-Tools-Types](https://github.com/rse/graphql-tools-types),
the GraphQL subscription management library [GraphQL-Tools-Subscribe](https://github.com/rse/graphql-tools-subscribe),
the network communication framework [HAPI](https://hapijs.com),
the WebSocket integration plugin [HAPI-Plugin-WebSocket](https://github.com/rse/hapi-plugin-websocket)
and the GraphiQL integration plugin [HAPI-Plugin-GraphiQL](https://github.com/rse/hapi-plugin-graphiql).
It has be used with the corresponding [GraphQL-IO-Client](https://github.com/rse/graphql-io-client)
network communication framework on the JavaScript client side.

Installation
------------

```shell
$ npm install graphql-io-server
```

Usage
-----

Simple "Hello World":

```js
const { Server } = require("graphql-io-server")
;(async () => {
    const sv = new Server()
    sv.register()
    await sv.start()
})()
```

Complex Example:

```js
import pbkdf2 from "pbkdf2-utils"
sv.at("account-for-username-password", async (ctx) => {
    let account = null
    if (   typeof ctx.username === "string" && ctx.username !== ""
        && typeof ctx.password === "string") {
        account = await dm.Account.findOne({ where: { "username": ctx.username } })
        if (account === null) {
            ctx.error = "no such account"
            return
        }
        let buf = new Buffer(account.password, "hex")
        let valid = await pbkdf2.verify(password, buf)
        if (!valid) {
            ctx.error = "invalid password"
            return
        }
    }
    else {
        account = await dm.Account.findOne({ where: { "username": "anonymous" } })
        if (account === null) {
            ctx.error = "account \"anonymous\" not found"
            return
        }
    }
    ctx.accountId = account.id
})
sv.at("session-create", async (ctx) => {
    ctx.sessionId = (new UUID(1)).format()
    let session = dm.Session.build({
        id: ctx.sessionId,
        expiresOn: Date.now() + ctx.ttl
    })
    await session.save()
    await session.setAccount(ctx.accountId)
})
sv.at("session-details", async (ctx) => {
   if (typeof ctx.sessionId === "string") {
        let session = await dm.Session.findById(ctx.sessionId)
        if (session !== null && Date.now() >= session.expiresOn) {
            await session.destroy()
            session = null
        }
        if (session === null)
            ctx.sessionId = null
    }
    if (typeof ctx.accountId === "string") {
        let account = await dm.Account.findById(ctx.accountId)
        if (account === null)
            ctx.accountId = null
    }
})
sv.at("session-destroy", async (ctx) => {
    let session = await dm.Session.findById(ctx.sessionId)
    if (session !== null)
        await session.destroy()
})
let job = schedule.scheduleJob("0 */30 * * * *", () => {
    let sessions = await dm.Session.findAll({
        where: { expiresOn: { $lte: Date.now() } }
    })
    sessions.forEach(async (session) => {
        await session.destroy()
    })
})
sv.at("graphql-transaction", async (ctx) => {
    return (cb) => {
        /*  wrap GraphQL operation into a database transaction  */
        return db.transaction({
            autocommit:     false,
            deferrable:     true,
            type:           db.Transaction.TYPES.DEFERRED,
            isolationLevel: db.Transaction.ISOLATION_LEVELS.SERIALIZABLE
        }, (tx) => {
            cb(tx)
        })
    }
})
sv.at("blob", (name) => {
    if (name === "foo")
        return { filename: name, type: "text/plain", content: "foo" }
    else
        return { path: path.join(__dirname, name), filename: name }
})
```

Application Programming Interface (API)
---------------------------------------

See the [TypeScript type definition of the GraphQL-IO-Client API](src/graphql-io.d.ts) for details.

License
-------

Copyright (c) 2016-2017 Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

