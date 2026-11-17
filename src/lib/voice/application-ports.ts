export type VoicePort = {
  snapshot?: () => Record<string, string>;
  patch?: (values: Record<string, string>) => void;
  open?: (target: string, query?: string | null) => void;
  search?: (query: string) => void;
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
      if (port) return port;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("SNOOP_FORM_UNAVAILABLE");
  }
}
export const applicationPorts = new ApplicationPorts();
