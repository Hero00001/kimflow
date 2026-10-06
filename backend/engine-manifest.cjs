// backend/engine-manifest.cjs — frozen download table. New upstream builds
// arrive as manifest patches; the app never queries release APIs at runtime.
const ENGINES = {
  cpu: {
    key: 'cpu',
    label: 'CPU',
    sizeLabel: '~8 MB',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
    sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
    bytes: 8573270,
    binaryName: 'whisper-cli.exe',
    notes: 'Runs on any 64-bit CPU. Slowest, most compatible.',
  },
  nvidia: {
    key: 'nvidia',
    label: 'NVIDIA',
    sizeLabel: '~273 MB',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-11.8.0-bin-x64.zip',
    sha256: '0b29b2175bb17ec26da29677cbc7c467c57d103245144d62a49a703f6bc3fdae',
    bytes: 272982859,
    binaryName: 'whisper-cli.exe',
    notes: 'Needs an NVIDIA GPU + recent driver. CUDA 11.8 build for wide compatibility.',
  },
  amd: {
    key: 'amd',
    label: 'AMD',
    sizeLabel: '~18 MB',
    url: 'https://github.com/Hero00001/kimflow-engines/releases/download/engine-vulkan-b5130/whisper-vulkan-win-x64-b5130.zip',
    sha256: 'dec3e0d20141ac93c4e6c54a68cb5da3a6e8ac997833c1e4a278e196e166ad06',
    bytes: 18268815,
    binaryName: 'whisper-cli.exe',
    notes: 'Vulkan build for AMD/Intel GPUs. Needs an AVX2-capable CPU; verified by smoke test after download.',
  },
};

const ENGINE_FLAVORS = Object.keys(ENGINES);

function validateFlavor(flavor) {
  if (!Object.prototype.hasOwnProperty.call(ENGINES, flavor)) {
    throw new Error(`Unknown engine flavor: ${flavor}`);
  }
  return flavor;
}

function getEngineSpec(flavor) {
  validateFlavor(flavor);
  return { ...ENGINES[flavor] };
}

module.exports = { ENGINE_FLAVORS, getEngineSpec, validateFlavor };
