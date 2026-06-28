import { expect } from "chai";
import { ethers } from "hardhat";

describe("RevocationRegistry", () => {
  const HASH = ethers.keccak256(ethers.toUtf8Bytes("kyc-vc-001"));

  // 部署 IssuerRegistry 並背書 issuer / otherIssuer；outsider 為未受信任位址。
  async function deploy() {
    const [issuer, otherIssuer, outsider] = await ethers.getSigners();
    const IR = await ethers.getContractFactory("IssuerRegistry");
    const issuerRegistry = await IR.deploy(); // owner = issuer(signer0)
    await issuerRegistry.waitForDeployment();
    await issuerRegistry.setTrustedIssuer(issuer.address, true);
    await issuerRegistry.setTrustedIssuer(otherIssuer.address, true);

    const Factory = await ethers.getContractFactory("RevocationRegistry");
    const registry = await Factory.deploy(await issuerRegistry.getAddress());
    await registry.waitForDeployment();
    return { registry, issuerRegistry, issuer, otherIssuer, outsider };
  }

  it("預設未撤銷", async () => {
    const { registry } = await deploy();
    expect(await registry.isRevoked(HASH)).to.equal(false);
  });

  it("受信任 issuer 撤銷後 isRevoked=true 並綁定 issuer + 發事件", async () => {
    const { registry, issuer } = await deploy();
    await expect(registry.revoke(HASH))
      .to.emit(registry, "CredentialRevoked")
      .withArgs(HASH, issuer.address);
    expect(await registry.isRevoked(HASH)).to.equal(true);
    expect(await registry.issuerOf(HASH)).to.equal(issuer.address);
  });

  it("未受信任位址不可撤銷（revert）— 杜絕任意第三方惡意撤銷", async () => {
    const { registry, outsider } = await deploy();
    await expect(
      registry.connect(outsider).revoke(HASH)
    ).to.be.revertedWith("RevocationRegistry: untrusted issuer");
    expect(await registry.isRevoked(HASH)).to.equal(false);
  });

  it("原 issuer 可復原撤銷", async () => {
    const { registry, issuer } = await deploy();
    await registry.revoke(HASH);
    await expect(registry.unrevoke(HASH))
      .to.emit(registry, "CredentialUnrevoked")
      .withArgs(HASH, issuer.address);
    expect(await registry.isRevoked(HASH)).to.equal(false);
  });

  it("另一受信任 issuer 不可撤銷他人已綁定的 VC（revert）", async () => {
    const { registry, otherIssuer } = await deploy();
    await registry.revoke(HASH); // 綁定為 signer0
    await expect(
      registry.connect(otherIssuer).revoke(HASH)
    ).to.be.revertedWith("RevocationRegistry: not issuer");
  });

  it("非原 issuer 不可復原（revert）", async () => {
    const { registry, otherIssuer } = await deploy();
    await registry.revoke(HASH);
    await expect(
      registry.connect(otherIssuer).unrevoke(HASH)
    ).to.be.revertedWith("RevocationRegistry: not issuer");
  });

  it("未被任何人撤銷的 hash 不可被非綁定者復原（revert）", async () => {
    const { registry, otherIssuer } = await deploy();
    await expect(
      registry.connect(otherIssuer).unrevoke(HASH)
    ).to.be.revertedWith("RevocationRegistry: not issuer");
  });
});
