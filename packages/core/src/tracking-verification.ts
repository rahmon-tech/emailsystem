import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { canonicalDomain } from "./reputation";

// Prove DNS ownership AND a valid HTTPS route back to this installation.
// Pin the public DNS result for the connection; never follow redirects.
export async function verifyTrackingHost(
  hostname: string,
  proof: string,
  basePath: string,
) {
  const address = await verifiedPublicAddress(hostname, proof);
  if (!address) return false;
  return await probeTrackingRoute(hostname, proof, basePath, address);
}

export async function verifiedPublicAddress(
  hostname: string,
  proof: string,
  resolver: Pick<
    Resolver,
    "resolveTxt" | "resolve4" | "resolve6"
  > = new Resolver({ timeout: 2000, tries: 1 }),
) {
  if (canonicalDomain(hostname) !== hostname) return false;
  const records = await resolver.resolveTxt(`_emailblast.${hostname}`);
  if (
    !records.some(
      (parts) => parts.join("") === `emailblast-verification=${proof}`,
    )
  )
    return false;
  const lookups = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);
  const addresses = lookups.flatMap((result, index) =>
    result.status === "fulfilled"
      ? result.value.map((address) => ({ address, family: index ? 6 : 4 }))
      : [],
  );
  if (
    !addresses.length ||
    addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
  )
    return false;
  return addresses[0];
}

async function probeTrackingRoute(
  hostname: string,
  proof: string,
  basePath: string,
  address: { address: string; family: number },
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const req = request(
      {
        hostname,
        port: 443,
        servername: hostname,
        method: "GET",
        path: `${basePath}/tracking/verify/${proof}`,
        headers: { Accept: "text/plain" },
        lookup: (_name, options, cb) =>
          cb(null, options.all ? [address] : address.address, address.family),
        rejectUnauthorized: true,
      },
      (res) => {
        let body = "",
          size = 0;
        if (res.statusCode !== 200) {
          res.destroy();
          finish(false);
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256) {
            res.destroy();
            finish(false);
          } else body += chunk.toString("utf8");
        });
        res.on("end", () => finish(body === `emailblast:${proof}`));
        res.on("error", () => finish(false));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(false);
    }, 5000);
    req.on("error", () => finish(false));
    req.end();
  });
}
