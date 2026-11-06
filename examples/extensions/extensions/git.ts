// Mounts git__github instructions and the git__pr skill. The git__gh tool
// requires GitHub broker configuration; this unconfigured mount does not enable it.
// Third-party extensions mount the same way.
export { default } from "@coraxjs/core/extensions/git";
