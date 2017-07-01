(async () => {

    /*  Hello World Server  */
    const { Server } = require("graphql-io-server")
    const sv = new Server({ url: "http://127.0.0.1:12345/api" })
    sv.on("debug", ({ log }) => console.log(log))
    sv.at("graphql-resolver", () => ({
        Root: {
            hello: [ `
                #   hello world
                hello(name: String): String`,
                (obj, args, ctx, info) => {
                    return args.name ? args.name : "world"
                }
            ]
        }
    }))
    await sv.start()

})().catch((err) => {
    console.log("ERROR", err)
})
