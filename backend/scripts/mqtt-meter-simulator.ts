import * as mqtt from 'mqtt';
import { randomUUID } from 'crypto';

interface CommandPayload {
  commandId: string;
  action: 'SWITCH_OFF' | 'SWITCH_ON' | 'TRIGGER_READING';
  reason?: string;
  issuedAt: string;
  timeoutSeconds?: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      options[key] = val !== undefined ? val : 'true';
    }
  }

  return options;
}

async function run() {
  const options = parseArgs();
  const brokerUrl = process.env.MQTT_BROKER_URL || options.broker || 'mqtt://localhost:1883';
  const meterNumber = options.meterNumber || 'ELEC-101';
  const meterType = (options.meterType || 'ELECTRICITY').toUpperCase();
  const intervalSec = options.interval ? parseInt(options.interval, 10) : 10;
  const isOnce = options.once === 'true';

  let currentReading = options.startReading ? parseFloat(options.startReading) : 120.5;
  let relayStatus: 'ON' | 'OFF' = 'ON';

  const telemetryTopic = `tenant-system/meters/${meterType}/${meterNumber}/telemetry`;
  const commandTopic = `tenant-system/meters/${meterType}/${meterNumber}/command`;
  const commandAckTopic = `tenant-system/meters/${meterType}/${meterNumber}/command/ack`;

  console.log('====================================================');
  console.log('📡 虚拟 MQTT 智能表客户端 (ADR-003 IoT Simulator)');
  console.log('====================================================');
  console.log(`- Broker 地址: ${brokerUrl}`);
  console.log(`- 模拟表号: ${meterNumber}`);
  console.log(`- 表计类型: ${meterType}`);
  console.log(`- 初始读数: ${currentReading}`);
  console.log(`- 继电器状态: ${relayStatus}`);
  console.log(`- 上行遥测 Topic: ${telemetryTopic}`);
  console.log(`- 下行指令 Topic: ${commandTopic}`);
  console.log(`- 执行确认 Topic: ${commandAckTopic}`);
  console.log(`- 上报模式: ${isOnce ? '单次上报后退出' : `每隔 ${intervalSec} 秒定时上报`}`);
  console.log('正在连接 MQTT Broker...');

  const clientId = `virtual-meter-${meterNumber}-${Date.now().toString(36)}`;
  const client = mqtt.connect(brokerUrl, {
    clientId,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 2000,
  });

  const publishTelemetry = () => {
    // 若拉闸断电，用量基本不走；合闸时每次随机消耗 0.05 ~ 0.25 kWh
    const delta = relayStatus === 'ON' ? Math.round((0.05 + Math.random() * 0.2) * 100) / 100 : 0.0;
    currentReading = Math.round((currentReading + delta) * 100) / 100;

    const voltage = Math.round((220 + (Math.random() * 4 - 2)) * 10) / 10;
    const current = relayStatus === 'ON' ? Math.round((1.8 + Math.random() * 1.5) * 100) / 100 : 0.0;
    const power = Math.round(voltage * current * 100) / 100;

    const payload = {
      messageId: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
      meterNumber,
      meterType,
      timestamp: new Date().toISOString(),
      reading: currentReading,
      relayStatus,
      metrics: {
        voltage,
        current,
        power,
        signalRssi: -60 - Math.floor(Math.random() * 10),
        batteryPercent: 100,
      },
    };

    client.publish(telemetryTopic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        console.error('❌ 遥测发布失败:', err.message);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] 📤 上报遥测成功: 读数 = ${currentReading} | 继电器 = ${relayStatus} | 功率 = ${power}W (msgId: ${payload.messageId})`);
      }
    });
  };

  client.on('connect', () => {
    console.log('✅ 成功连接至 MQTT Broker！');

    // 订阅下行控制命令
    client.subscribe(commandTopic, { qos: 1 }, (err) => {
      if (err) {
        console.error('❌ 订阅控制指令失败:', err.message);
      } else {
        console.log(`👂 已成功监听下行指令: ${commandTopic}`);
      }
    });

    // 发布首包遥测
    publishTelemetry();

    if (isOnce) {
      setTimeout(() => {
        console.log('单次上报完成，断开连接。');
        client.end();
        process.exit(0);
      }, 500);
      return;
    }

    // 周期上报
    const timer = setInterval(publishTelemetry, intervalSec * 1000);

    process.on('SIGINT', () => {
      console.log('\n收到退出信号，正在关闭模拟器...');
      clearInterval(timer);
      client.end(false, () => {
        console.log('MQTT 客户端已断开。');
        process.exit(0);
      });
    });
  });

  client.on('message', (topic, message) => {
    if (topic === commandTopic) {
      try {
        const cmd: CommandPayload = JSON.parse(message.toString());
        console.log(`\n📥 收到下行控制指令: action=${cmd.action}, commandId=${cmd.commandId}, reason=${cmd.reason || '无'}`);

        if (cmd.action === 'SWITCH_OFF') {
          relayStatus = 'OFF';
          console.log(`⚡ [执行动作] 继电器已断开 (SWITCH_OFF)！当前表计断电/断水。`);
        } else if (cmd.action === 'SWITCH_ON') {
          relayStatus = 'ON';
          console.log(`⚡ [执行动作] 继电器已吸合 (SWITCH_ON)！当前表计恢复供电/供水。`);
        } else if (cmd.action === 'TRIGGER_READING') {
          console.log(`⚡ [执行动作] 响应点抄召测指令，立即上报当前读数。`);
          publishTelemetry();
        }

        // 发送确认 ACK
        const ackPayload = {
          commandId: cmd.commandId,
          meterNumber,
          action: cmd.action,
          status: 'EXEC_SUCCESS',
          relayStatus,
          executedAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
        };

        client.publish(commandAckTopic, JSON.stringify(ackPayload), { qos: 1 }, (ackErr) => {
          if (ackErr) {
            console.error('❌ 发布 ACK 失败:', ackErr.message);
          } else {
            console.log(`✅ [ACK 回执已发送] commandId=${cmd.commandId}, status=EXEC_SUCCESS, relayStatus=${relayStatus}`);
          }
        });
      } catch (err: any) {
        console.error('❌ 解析下行指令失败:', err.message);
      }
    }
  });

  client.on('error', (err) => {
    console.error('❌ MQTT 客户端连接异常:', err.message);
  });
}

run();
