// Compiles contracts/HyperTwin.sol into assets/twin.json (abi + bytecode) for the page and the relay.
// node tools/build.mjs
import fs from 'node:fs'
import solc from 'solc'
const src = fs.readFileSync(new URL('../contracts/HyperTwin.sol', import.meta.url), 'utf8')
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'HyperTwin.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
})))
for (const e of out.errors || []) console.log(e.severity, e.formattedMessage)
const c = out.contracts['HyperTwin.sol'].HyperTwin
fs.writeFileSync(new URL('../assets/twin.json', import.meta.url), JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }))
console.log('bytecode', c.evm.bytecode.object.length / 2, 'bytes')
