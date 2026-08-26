export class ProxyRotator {
  private index = 0;

  constructor(private readonly proxies: string[]) {}

  next(): string | undefined {
    if (this.proxies.length === 0) {
      return undefined;
    }
    const proxy = this.proxies[this.index % this.proxies.length];
    this.index += 1;
    return proxy;
  }

  get size(): number {
    return this.proxies.length;
  }
}
