import { httpBasic, localDev } from "@coraxjs/core/channels/auth";
import { coraxChannel } from "@coraxjs/core/channels/corax";

const password = process.env.CORAX_PASSWORD;

export default coraxChannel({
  auth: [
    ...(password
      ? [httpBasic({ username: process.env.CORAX_USERNAME || "admin", password })]
      : []),
    localDev(),
  ],
});
