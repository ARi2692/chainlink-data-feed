// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { ReceiverTemplate } from "./interfaces/ReceiverTemplate.sol";

/**
 * @title PriceSnapshot
 * @notice On-chain registry for storing Chainlink price snapshots
 * @dev Receives CRE workflow reports containing token price data
 *
 * Flow:
 * 1. CRE workflow reads price from Chainlink Data Feed (EVM Read)
 * 2. CRE workflow encodes Record and sends signed report to this contract
 * 3. Contract decodes report and stores snapshot in mapping
 */
contract PriceSnapshot is ReceiverTemplate {

    // ============================================================================
    // Types & Data Structures
    // ============================================================================

    /**
     * @notice Price snapshot record
     * @param token   Token symbol e.g. "ETH", "BTC", "LINK", DAI
     * @param price   USD price from Chainlink answer (scaled ×1e8)
     * @param blockNumber Block at which the Chainlink feed was last updated (updatedAt)
     * @param timestamp   Unix timestamp (seconds) when snapshot was taken
     */
    struct Record {
        string  token;
        uint256 price;
        uint256 blockNumber;
        uint256 timestamp;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /**
     * @notice Total number of snapshots stored
     * @dev Increments each time a new snapshot is written
     */
    uint256 public nextSnapshotId;

    /**
     * @notice All snapshots by incremental ID
     */
    mapping(uint256 => Record) private snapshots;

    /**
     * @notice Latest snapshot per token symbol
     * @dev Overwritten on every new snapshot for the same token
     */
    mapping(string => Record) private latestSnapshot;

    // ============================================================================
    // Events
    // ============================================================================

    /**
     * @notice Emitted when a new price snapshot is stored
     * @param snapshotId Incremental ID assigned to this snapshot
     * @param token      Token symbol
     * @param price      USD price (×1e8)
     * @param blockNumber Block when Chainlink feed was last updated
     * @param timestamp  Unix timestamp of snapshot
     */
    event Snapshot(
        uint256 indexed snapshotId,
        string  indexed token,
        uint256 price,
        uint256 blockNumber,
        uint256 timestamp
    );

    // ============================================================================
    // Constructor
    // ============================================================================

    /**
     * @param _forwarderAddress Chainlink CRE forwarder address for this network
     * @dev Find the correct forwarder in the CRE documentation for Sepolia
     */
    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {
        require(_forwarderAddress != address(0), "PriceSnapshot: forwarder cannot be zero");
    }

    // ============================================================================
    // CRE Workflow Integration (IReceiverTemplate Implementation)
    // ============================================================================

    /**
     * @notice Called by ReceiverTemplate when a verified CRE report arrives
     * @dev Report must be ABI-encoded as:
     *      (string token, uint256 price, uint256 blockNumber, uint256 timestamp)
     *
     *      This matches encodeAbiParameters() in the CRE workflow:
     *      parseAbiParameters("string token, uint256 price, uint256 blockNumber, uint256 timestamp")
     *
     * @param report ABI-encoded Record fields from the CRE workflow
     */
    function _processReport(bytes calldata report) internal override {
        // Decode report data
        (
            string memory token,
            uint256 price,
            uint256 blockNumber,
            uint256 timestamp
        ) = abi.decode(report, (string, uint256, uint256, uint256));

        // Assign snapshot ID
        uint256 snapshotId = nextSnapshotId;
        nextSnapshotId++;

        // Build record
        Record memory record = Record({
            token:       token,
            price:       price,
            blockNumber: blockNumber,
            timestamp:   timestamp
        });

        // Store by ID 
        snapshots[snapshotId] = record;

        // Store as latest for this token (overwritten each time)
        latestSnapshot[token] = record;

        emit Snapshot(snapshotId, token, price, blockNumber, timestamp);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /**
     * @notice Get a snapshot by its incremental ID
     */
    function getSnapshot(uint256 _id) public view returns (Record memory) {
        require(_id < nextSnapshotId, "PriceSnapshot: does not exist");
        return snapshots[_id];
    }

    /**
     * @notice Get the most recent snapshot for a token
     * @param token Token symbol e.g. "ETH"
     */
    function getLatestSnapshot(string calldata token) public view returns (Record memory) {
        return latestSnapshot[token];
    }

    /**
     * @notice Get all snapshots ever stored
     * @dev Can be gas-heavy for large counts — use getSnapshot() for pagination
     */
    function getAllSnapshots() public view returns (Record[] memory) {
        Record[] memory all = new Record[](nextSnapshotId);
        for (uint256 i = 0; i < nextSnapshotId; i++) {
            all[i] = snapshots[i];
        }
        return all;
    }

}