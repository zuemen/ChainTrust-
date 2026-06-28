// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIssuerRegistry {
    function isTrustedIssuer(address issuer) external view returns (bool);
}

/// @title RevocationRegistry — 憑證撤銷登記（撤銷權綁定信任根）
/// @notice 撤銷權僅限「受 IssuerRegistry（中華電信 PublicCA 根）背書的簽發者」。
///         首位撤銷某 VC 的受信任 issuer 被記為該 VC 的 issuer，之後僅其可 revoke/unrevoke。
///         未受信任的任意第三方無法撤銷任何 VC —— 杜絕「知道 revocationKey 即可惡意撤銷他人有效憑證」的攻擊。
contract RevocationRegistry {
    /// @notice 信任根登記（用於授權撤銷者）
    IIssuerRegistry public immutable issuerRegistry;

    /// @dev credentialHash => 是否已撤銷
    mapping(bytes32 => bool) private _revoked;

    /// @notice credentialHash => 綁定的 issuer（首位撤銷此 VC 的受信任簽發者）
    mapping(bytes32 => address) public issuerOf;

    event CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer);
    event CredentialUnrevoked(bytes32 indexed credentialHash, address indexed issuer);

    /// @notice IssuerRegistry 位址不可為零
    error ZeroRegistry();
    /// @notice 呼叫者非受信任根背書的簽發者
    error UntrustedIssuer();
    /// @notice 呼叫者非此 VC 綁定的簽發者
    error NotCredentialIssuer();

    constructor(address issuerRegistry_) {
        if (issuerRegistry_ == address(0)) revert ZeroRegistry();
        issuerRegistry = IIssuerRegistry(issuerRegistry_);
    }

    /// @dev 僅信任根背書的簽發者可呼叫
    modifier onlyTrustedIssuer() {
        if (!issuerRegistry.isTrustedIssuer(msg.sender)) revert UntrustedIssuer();
        _;
    }

    /// @notice 撤銷一張 VC。首位撤銷者必須是受信任簽發者，並被綁定為該 VC 的 issuer。
    function revoke(bytes32 credentialHash) external onlyTrustedIssuer {
        address issuer = issuerOf[credentialHash];
        if (issuer == address(0)) {
            issuerOf[credentialHash] = msg.sender;
        } else if (issuer != msg.sender) {
            revert NotCredentialIssuer();
        }
        _revoked[credentialHash] = true;
        emit CredentialRevoked(credentialHash, msg.sender);
    }

    /// @notice 復原撤銷（僅原綁定 issuer）
    function unrevoke(bytes32 credentialHash) external {
        if (issuerOf[credentialHash] != msg.sender) revert NotCredentialIssuer();
        _revoked[credentialHash] = false;
        emit CredentialUnrevoked(credentialHash, msg.sender);
    }

    /// @notice 查詢某 VC 是否已撤銷
    function isRevoked(bytes32 credentialHash) external view returns (bool) {
        return _revoked[credentialHash];
    }
}
