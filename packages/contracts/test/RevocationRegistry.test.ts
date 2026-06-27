import { expect } from "chai";
import { ethers } from "hardhat";

describe("RevocationRegistry", () => {
  const HASH = ethers.keccak256(ethers.toUtf8Bytes("kyc-vc-001"));

  async function deploy() {
    const [issuer, otherIssuer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RevocationRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, issuer, otherIssuer };
  }

  it("預設未撤銷", async () => {
    const { registry } = await deploy();
    expect(await registry.isRevoked(HASH)).to.equal(false);
  });

  it("撤銷後 isRevoked=true 並綁定 issuer + 發事件", async () => {
    const { registry, issuer } = await deploy();
    await expect(registry.revoke(HASH))
      .to.emit(registry, "CredentialRevoked")
      .withArgs(HASH, issuer.address);
    expect(await registry.isRevoked(HASH)).to.equal(true);
    expect(await registry.issuerOf(HASH)).to.equal(issuer.address);
  });

  it("原 issuer 可復原撤銷", async () => {
    const { registry, issuer } = await deploy();
    await registry.revoke(HASH);
    await expect(registry.unrevoke(HASH))
      .to.emit(registry, "CredentialUnrevoked")
      .withArgs(HASH, issuer.address);
    expect(await registry.isRevoked(HASH)).to.equal(false);
  });

  it("非原 issuer 不可再撤銷（revert）", async () => {
    const { registry, otherIssuer } = await deploy();
    await registry.revoke(HASH); // issuer 綁定為 signer[0]
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

  it("未被任何人撤銷的 hash 不可被非綁定者復原", async () => {
    const { registry, otherIssuer } = await deploy();
    await expect(
      registry.connect(otherIssuer).unrevoke(HASH)
    ).to.be.revertedWith("RevocationRegistry: not issuer");
  });
});
