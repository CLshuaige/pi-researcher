import { EnvHttpProxyAgent, install, setGlobalDispatcher } from 'undici';

/** The Pi CLI configures Undici itself; an embedded SDK host must do the same. */
export function configureNetwork() {
  const bypass = [
    process.env.no_proxy || process.env.NO_PROXY || '',
    'localhost',
    '127.0.0.1',
    '::1',
  ]
    .filter(Boolean)
    .join(',');
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      noProxy: bypass,
      allowH2: false,
      proxyTunnel: true,
      headersTimeout: 300000,
      bodyTimeout: 300000,
      connect: { autoSelectFamilyAttemptTimeout: 2000 },
    }),
  );
  // Use matching fetch/dispatcher versions, as Pi 1.4.0's CLI does.
  install();
}
