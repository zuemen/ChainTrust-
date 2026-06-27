import {
  createAgent,
  type TAgent,
  type IDIDManager,
  type IKeyManager,
  type IResolver,
  type ICredentialPlugin,
} from "@veramo/core";
import { DIDManager, MemoryDIDStore } from "@veramo/did-manager";
import {
  KeyManager,
  MemoryKeyStore,
  MemoryPrivateKeyStore,
} from "@veramo/key-manager";
import { KeyManagementSystem } from "@veramo/kms-local";
import { EthrDIDProvider } from "@veramo/did-provider-ethr";
import { KeyDIDProvider } from "@veramo/did-provider-key";
import { DIDResolverPlugin } from "@veramo/did-resolver";
import { Resolver } from "did-resolver";
import { getResolver as ethrDidResolver } from "ethr-did-resolver";
import { getResolver as keyDidResolver } from "key-did-resolver";
import { CredentialPlugin } from "@veramo/credential-w3c";
import { config } from "./config.js";

type ChainTrustPlugins = IDIDManager & IKeyManager & IResolver & ICredentialPlugin;
/** 設定完成的 agent 型別：方法為單參數（context 由 agent 自動注入） */
export type ChainTrustAgent = TAgent<ChainTrustPlugins>;

const KMS = "local";

/**
 * 建立 Veramo agent：
 * - did:key（Holder，離線可解析）+ did:ethr（Issuer，位址對應 IssuerRegistry）
 * - credential-w3c（簽發/驗證 W3C VC，JWT/ES256K）
 * 金鑰僅存記憶體（MemoryPrivateKeyStore），不落地、不入庫。
 */
export function createVeramoAgent() {
  const ethrNetworks = [
    {
      name: config.ethrNetwork,
      chainId: config.ethrChainId,
      rpcUrl: config.amoyRpcUrl,
    },
  ];

  return createAgent<ChainTrustPlugins>({
    plugins: [
      new KeyManager({
        store: new MemoryKeyStore(),
        kms: {
          [KMS]: new KeyManagementSystem(new MemoryPrivateKeyStore()),
        },
      }),
      new DIDManager({
        store: new MemoryDIDStore(),
        defaultProvider: "did:key",
        providers: {
          "did:key": new KeyDIDProvider({ defaultKms: KMS }),
          "did:ethr": new EthrDIDProvider({
            defaultKms: KMS,
            networks: ethrNetworks,
          }),
        },
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...keyDidResolver(),
          ...ethrDidResolver({ networks: ethrNetworks }),
        }),
      }),
      new CredentialPlugin(),
    ],
  });
}

/** 建立 Issuer DID（did:key + Secp256k1，可離線解析且能推導 ETH 位址） */
export async function createIssuerDid(agent: ChainTrustAgent, alias = "issuer") {
  return agent.didManagerCreate({
    alias,
    provider: "did:key",
    options: { keyType: "Secp256k1" },
  });
}

/** 建立 Holder DID（did:key，錢包持有者） */
export async function createHolderDid(agent: ChainTrustAgent, alias = "holder") {
  return agent.didManagerCreate({
    alias,
    provider: "did:key",
    options: { keyType: "Secp256k1" },
  });
}
