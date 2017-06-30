
const { Server } = require("graphql-io-server")

;(async () => {
    const sv = new Server({ url: "http://127.0.0.1:12345/api" })
    sv.on("debug", ({ log }) => console.log(log))
    sv.at("graphql-resolver", () => ({
        Root: {
            hello: [ `hello: String` , () => "world" ]
        }
    }))
    await sv.start()
})().catch((err) => {
    console.log("ERROR", err)
})
