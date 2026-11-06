import { defineSandbox } from "@coraxjs/core/sandbox";
import { JustBashSandbox } from "@coraxjs/core/sandbox/just-bash";

export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
