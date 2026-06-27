import { expect } from "chai";
import { ethers } from "hardhat";

describe("IssuerRegistry", () => {
  async function deploy() {
    const [owner, issuer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("IssuerRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, owner, issuer, other };
  }

  it("owner 設為部署者", async () => {
    const { registry, owner } = await deploy();
    expect(await registry.owner()).to.equal(owner.address);
  });

  it("預設未信任", async () => {
    const { registry, issuer } = await deploy();
    expect(await registry.isTrustedIssuer(issuer.address)).to.equal(false);
  });

  it("owner 可信任 issuer 並發事件", async () => {
    const { registry, issuer } = await deploy();
    await expect(registry.setTrustedIssuer(issuer.address, true))
      .to.emit(registry, "IssuerTrustChanged")
      .withArgs(issuer.address, true);
    expect(await registry.isTrustedIssuer(issuer.address)).to.equal(true);
  });

  it("owner 可取消信任", async () => {
    const { registry, issuer } = await deploy();
    await registry.setTrustedIssuer(issuer.address, true);
    await registry.setTrustedIssuer(issuer.address, false);
    expect(await registry.isTrustedIssuer(issuer.address)).to.equal(false);
  });

  it("非 owner 不可設定（revert）", async () => {
    const { registry, issuer, other } = await deploy();
    await expect(
      registry.connect(other).setTrustedIssuer(issuer.address, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("不可信任 zero address", async () => {
    const { registry } = await deploy();
    await expect(
      registry.setTrustedIssuer(ethers.ZeroAddress, true)
    ).to.be.revertedWith("IssuerRegistry: zero issuer");
  });
});
