import { localDev, placeholderAuth, vercelOidc } from "#public/channels/auth.js";
import { coraxChannel } from "#corax-channel/index.js";

export default function createDefaultCoraxChannel() {
  return coraxChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] });
}
