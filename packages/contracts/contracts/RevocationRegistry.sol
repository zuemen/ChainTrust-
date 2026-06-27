// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RevocationRegistry — 憑證撤銷登記
/// @notice 以 VC 的雜湊（credentialHash）為鍵記錄撤銷狀態。首次撤銷者被記為該 VC 的 issuer，
///         之後僅該 issuer 可再撤銷/復原。Verifier 查 isRevoked() 判斷 VC 是否已撤銷。
contract RevocationRegistry {
    /// @dev credentialHash => 是否已撤銷
    mapping(bytes32 => bool) private _revoked;

    /// @notice credentialHash => 首次操作（撤銷）此 VC 的 issuer 位址
    mapping(bytes32 => address) public issuerOf;

    event CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer);
    event CredentialUnrevoked(bytes32 indexed credentialHash, address indexed issuer);

    /// @notice 撤銷一張 VC。首次呼叫者被綁定為該 VC 的 issuer。
    function revoke(bytes32 credentialHash) external {
        address issuer = issuerOf[credentialHash];
        if (issuer == address(0)) {
            issuerOf[credentialHash] = msg.sender;
        } else {
            require(issuer == msg.sender, "RevocationRegistry: not issuer");
        }
        _revoked[credentialHash] = true;
        emit CredentialRevoked(credentialHash, msg.sender);
    }

    /// @notice 復原撤銷（僅原 issuer）
    function unrevoke(bytes32 credentialHash) external {
        require(issuerOf[credentialHash] == msg.sender, "RevocationRegistry: not issuer");
        _revoked[credentialHash] = false;
        emit CredentialUnrevoked(credentialHash, msg.sender);
    }

    /// @notice 查詢某 VC 是否已撤銷
    function isRevoked(bytes32 credentialHash) external view returns (bool) {
        return _revoked[credentialHash];
    }
}
