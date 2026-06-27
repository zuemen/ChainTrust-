// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title IssuerRegistry — 信任根背書登記
/// @notice owner 代表「中華電信 PublicCA 信任根」，用來標記哪些 Issuer 位址（對應 did:ethr）可信。
///         Verifier 驗章後查 isTrustedIssuer() 判斷該 VC 的簽發者是否受信任。
contract IssuerRegistry is Ownable {
    /// @dev issuer 位址 => 是否可信
    mapping(address => bool) private _trusted;

    event IssuerTrustChanged(address indexed issuer, bool trusted);

    constructor() Ownable(msg.sender) {}

    /// @notice 設定/取消某 Issuer 的信任狀態（僅信任根 owner）
    function setTrustedIssuer(address issuer, bool trusted) external onlyOwner {
        require(issuer != address(0), "IssuerRegistry: zero issuer");
        _trusted[issuer] = trusted;
        emit IssuerTrustChanged(issuer, trusted);
    }

    /// @notice 查詢某 Issuer 是否受信任
    function isTrustedIssuer(address issuer) external view returns (bool) {
        return _trusted[issuer];
    }
}
