import { httpBasic, localDev } from "corax/channels/auth";
import { coraxChannel } from "corax/channels/corax";

const password = process.env.CORAX_PASSWORD;

export default coraxChannel({
  auth: [
    ...(password
      ? [httpBasic({ username: process.env.CORAX_USERNAME || "admin", password })]
      : []),
    localDev(),
  ],
});
