# Agent-Playground

###
/home/zhenzhen/code/github/Agent-Playground/agent-qwen3_5/.agent-qwen3_5

/home/zhenzhen/code/github/Agent-Playground/agent-qwen3_5/server/requirements.txt

建立后端虚拟环境

###
cd /home/zhenzhen/code/github/Agent-Playground/agent-qwen3_5/frontend

npm install

npm run dev

### 运行前设置环境变量
export ANTHROPIC_BASE_URL=http://localhost:8000
export ANTHROPIC_API_KEY=YOUR_DASHSCOPE_API_KEY
export ANTHROPIC_MODEL=Qwen3.5-4B

终端code是用bun构建的

cd ~/code/Agent-Playground/Agent-Playground/claude-code
bun install
bun run dev
bun run build

应该不用bun编译产物

### 待修复问题
1. 终端一直在重连

### 本地调用vllm
```shell
### 本地Agent Terminal调用vllm
VLLM_USE_MODELSCOPE=True CUDA_VISIBLE_DEVICES=0 \
vllm serve /home/zhenzhen/code/vllm/models/Qwen3.5-4B \
  --gpu-memory-utilization 0.8 \
  --served-model-name Qwen3.5-4B \
  --trust-remote-code \
  --tensor-parallel-size 1 \
  --port 8000 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder
```
