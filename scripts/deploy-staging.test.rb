require 'yaml'

workflow = YAML.safe_load_file(File.expand_path('../.github/workflows/deploy-staging.yml', __dir__))
steps = workflow.fetch('jobs').fetch('deploy').fetch('steps')

checkout = steps.index { |step| step['uses']&.start_with?('actions/checkout@') }
setup = steps.index { |step| step['uses']&.start_with?('actions/setup-node@') }
deploy = steps.index { |step| step.fetch('run', '').include?('ssh -o BatchMode=yes') }
smoke = steps.index { |step| step.fetch('run', '').include?('node scripts/smoke.mjs') }

unless checkout && setup && deploy && smoke && checkout < setup && setup < deploy && deploy < smoke
  abort 'Staging 必须在 SSH 部署前 checkout 和安装 Node，并在部署成功后冒烟'
end

[checkout, setup, smoke].each do |index|
  abort 'Staging 的 checkout、Node 安装与冒烟必须随正常部署执行' if steps[index].key?('if')
end

abort 'Staging 冒烟脚本缺失' unless File.file?(File.expand_path('smoke.mjs', __dir__))
if ARGV == ['--smoke-command']
  puts steps.fetch(smoke).fetch('run')
else
  puts 'Staging checkout、Node、SSH 与冒烟顺序通过'
end
