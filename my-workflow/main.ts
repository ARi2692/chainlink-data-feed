import {
  cre,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  Runtime,
  Runner,
  LAST_FINALIZED_BLOCK_NUMBER,
} from "@chainlink/cre-sdk";
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from "viem";

type EvmConfig = {
  chainSelectorName: string;
};

type Config = {
  schedule: string;
  evms: EvmConfig[];
};

// Chainlink Price Feed ABI (simplified)
const priceFeedAbi = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

function onCronTrigger(runtime: Runtime<Config>): bigint {
  // Get the first EVM configuration from the list.
  const evmConfig = runtime.config.evms[0];

  // Get network configuration
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Unknown chain name: ${evmConfig.chainSelectorName}`);
  }

  // Create EVM client
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  // Encode function call
  const callData = encodeFunctionData({
    abi: priceFeedAbi,
    functionName: "latestRoundData",
    args: [],
  });

  // Execute contract call (with consensus!)
  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43", // BTC/USD feed on Eth Sepolia
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  // Decode result
  const priceData = decodeFunctionResult({
    abi: priceFeedAbi,
    functionName: "latestRoundData",
    data: bytesToHex(contractCall.data),
  }) as [bigint, bigint, bigint, bigint, bigint];

  // Convert price (8 decimals)
  const priceUsd = Number(priceData[1]) / 10 ** 8;

  runtime.log(`BTC Price: $${priceUsd.toFixed(2)}`);

  return priceData[1];
}

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();

  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
