
const pbkdf2 = require("pbkdf2-utils")

/*  login: recognize peer  */
sv.at("peer-recognize", async (ctx) => {
    let peer = await dm.Peer.findById(ctx.peerId)
    if (peer === null) {
        peer = dm.Peer.build({ id: ctx.peerId })
        await peer.save()
    }
    ctx.peerId = peer.id
})

/*  login: authenticate account  */
sv.at("account-authenticate", async (ctx) => {
    let account = null
    if (typeof ctx.username === "string" && ctx.username !== "" && typeof ctx.password === "string") {
        account = await dm.Account.findOne({ where: { "username": ctx.username } })
        if (account === null)
            return (ctx.error = "invalid authentication credentials")
        let buf = new Buffer(account.password, "hex")
        let valid = await pbkdf2.verify(password, buf)
        if (!valid)
            return (ctx.error = "invalid authentication credentials")
    }
    else
        account = await dm.Account.findOne({ where: { "username": "anonymous" } })
    ctx.accountId = account.id
})

/*  login: create session  */
sv.at("session-create", async (ctx) => {
    ctx.sessionId = (new UUID(1)).format()
    let session = dm.Session.build({ id: ctx.sessionId, expiresOn: Date.now() + ctx.ttl })
    await session.save()
    await session.setAccount(ctx.accountId)
    await session.setPeer(ctx.peerId)
})

/*  session: determine session details  */
sv.at("session-details", async (ctx) => {
    let peer = await dm.Peer.findById(ctx.peerId)
    if (peer === null)
        ctx.peerId = null
    let account = await dm.Account.findById(ctx.accountId)
    if (account === null)
        ctx.accountId = null
    let session = await dm.Session.findById(ctx.sessionId)
    if (session !== null && Date.now() >= session.expiresOn) {
        await session.destroy()
        session = null
    }
    if (session === null)
        ctx.sessionId = null
})

/*  logout: destroy session  */
sv.at("session-destroy", async (ctx) => {
    let session = await dm.Session.findById(ctx.sessionId)
    if (session !== null)
        await session.destroy()
    ctx.sessioId = null
})
let job = schedule.scheduleJob("0 */30 * * * *", () => {
    let sessions = await dm.Session.findAll({
        where: { expiresOn: { $lte: Date.now() } }
    })
    sessions.forEach(async (session) => {
        await session.destroy()
    })
})

sv.at("graphql-schema", () => {
})
sv.at("graphql-resolver", () => {
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

