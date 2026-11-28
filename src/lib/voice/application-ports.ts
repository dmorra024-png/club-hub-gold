/** Parent member routes also render order children; their hidden editor is not a capability. */
export function isMemberCardPath(path: string) {
  const match = /^\/soci\/([^/]+)\/?$/.exec(path);
  return !!match && !["nuovo", "gestisci", "importar"].includes(match[1]);
}
/** Runtime capabilities originate from the mounted form, never the model prompt.
 * No private form values are exported by this descriptor.
 */
export type VoiceFieldCapability = {
  visible: boolean;
  editable: boolean;
  required: boolean;
  type: "text" | "phone" | "email" | "date" | "identifier" | "number" | "choice";
};
export type VoicePort = {
  fieldCapabilities?: () => Record<string, VoiceFieldCapability>;
  refresh?: () => void | Promise<void>;
  ready?: () => boolean;
  snapshot?: () => Record<string, string>;
  baseline?: () => Record<string, string>;
  patch?: (values: Record<string, string>) => void;
  open?: (target: string, query?: string | null) => void;
  search?: (query: string) => void | "opened" | "multiple" | "not_found" | "unavailable" | Promise<void | "opened" | "multiple" | "not_found" | "unavailable">;
  stageStock?: (name: string, delta: string) => boolean;
};
export const voiceOwner = (user: string, club: string) => JSON.stringify([user, club]);
class ApplicationPorts {
  private ports = new Map<string, VoicePort>();
  register(owner: string, name: string, port: VoicePort) {
    const key = JSON.stringify([owner, name]);
    this.ports.set(key, port);
    return () => {
      if (this.ports.get(key) === port) this.ports.delete(key);
    };
  }
  get(owner: string, name: string) {
    return this.ports.get(JSON.stringify([owner, name]));
  }
  async wait(owner: string, name: string, valid: () => boolean, timeout = 4000) {
    const until = performance.now() + timeout;
    while (valid() && performance.now() < until) {
      const port = this.get(owner, name);
      if (port && (!port.ready || port.ready())) return port;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("SNOOP_FORM_UNAVAILABLE");
  }
}
export const applicationPorts = new ApplicationPorts();
