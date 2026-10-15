/**
 * 缴费单据与凭单图片生成工具（Voucher Utility）
 * 专为线下转账、凭单图片化分享与房东快速核销设计
 */

import { getLandlordContact, copyToClipboard } from './contact.js'

/**
 * 分转换大写人民币金额
 * 例如：250000 分 -> 貳仟伍佰元整
 * @param {number} cents 金额（单位：分）
 * @returns {string} 人民币大写
 */
export function centsToChineseUppercase(cents) {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents)) || Number(cents) < 0) {
    return '零元整'
  }

  const fenTotal = Math.round(Number(cents))
  if (fenTotal === 0) return '零元整'

  const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖']
  const radices = ['', '拾', '佰', '仟']
  const bigRadices = ['', '萬', '億']

  const yuan = Math.floor(fenTotal / 100)
  const fen = fenTotal % 100
  const jiao = Math.floor(fen / 10)
  const fenRemain = fen % 10

  let chineseStr = ''

  if (yuan > 0) {
    let zeroCount = 0
    const strYuan = String(yuan)
    const len = strYuan.length

    for (let i = 0; i < len; i++) {
      const p = len - i - 1
      const d = strYuan.substr(i, 1)
      const quotient = Math.floor(p / 4)
      const modulus = p % 4

      if (d === '0') {
        zeroCount++
      } else {
        if (zeroCount > 0) {
          chineseStr += '零'
        }
        zeroCount = 0
        chineseStr += digits[parseInt(d, 10)] + radices[modulus]
      }

      if (modulus === 0 && zeroCount < 4) {
        chineseStr += bigRadices[quotient]
      }
    }
    chineseStr += '元'
  }

  if (fen === 0) {
    chineseStr += '整'
  } else {
    if (jiao > 0) {
      chineseStr += digits[jiao] + '角'
    } else if (yuan > 0) {
      chineseStr += '零'
    }
    if (fenRemain > 0) {
      chineseStr += digits[fenRemain] + '分'
    }
  }

  return chineseStr
}

/**
 * 格式化单据核心数据
 * @param {Object} bill 账单详情对象
 * @param {Object} landlordContact 管家/房东联系方式
 * @returns {Object} 结构化单据展示与绘制数据
 */
export function formatVoucherData(bill = {}, landlordContact = {}) {
  const typeMap = {
    RENT: '房屋租金',
    UTILITY: '水电费用',
    DEPOSIT: '房屋押金',
    OTHER: '其他费用',
  }

  const statusMap = {
    PENDING: '待缴费',
    PARTIAL: '部分缴纳',
    PAID: '已缴清',
    OVERDUE: '已逾期',
    CANCELLED: '已取消',
  }

  const room = bill.contract?.room || {}
  const building = room.building || bill.contract?.building || {}
  const buildingName = building.name || ''
  const roomNumber = room.roomNumber || '—'

  let fullRoomTitle = roomNumber
  if (buildingName && roomNumber !== '—') {
    fullRoomTitle = `${buildingName} · ${roomNumber}室`
  } else if (buildingName) {
    fullRoomTitle = buildingName
  }

  const billAmount = Number(bill.amount) || 0
  const paidAmount = Number(bill.paidAmount) || 0
  const unpaidAmount = Math.max(0, billAmount - paidAmount)
  // 待缴只表示尚未支付的本金。已缴清时为 0，不能回退成账单原额。
  const amountToPayCents = unpaidAmount
  const amountToPayYuan = (amountToPayCents / 100).toFixed(2)

  const billNo = bill.billNumber || bill.id || ''
  const dueDate = bill.dueDate ? String(bill.dueDate).slice(0, 10) : '—'
  const tenantName = bill.contract?.tenant?.name || '租客'

  const contact = landlordContact.wechat ? landlordContact : getLandlordContact({}, [bill.contract])

  return {
    billId: bill.id || '',
    billNumber: billNo,
    fullRoomTitle,
    roomNumber,
    tenantName,
    period: bill.period || '当期',
    typeLabel: typeMap[bill.billType] || '租赁费用',
    billAmountYuan: (billAmount / 100).toFixed(2),
    paidAmountYuan: (paidAmount / 100).toFixed(2),
    unpaidAmountYuan: (unpaidAmount / 100).toFixed(2),
    amountToPayCents,
    amountToPayYuan,
    chineseUppercase: centsToChineseUppercase(amountToPayCents),
    dueDate,
    status: bill.status || 'PENDING',
    statusLabel: statusMap[bill.status] || '待缴费',
    landlordName: contact.name || '栖居专属管家',
    landlordPhone: contact.formattedPhone || contact.phone || '',
    landlordWechat: contact.wechat || '',
    verifyCode: `[VOUCHER:${billNo}:${amountToPayCents}]`,
  }
}

/**
 * 生成可一键复制并发送到微信聊天的结构化文字摘要
 * 房东粘贴该文本到后台即可被正规表达式自动提取识别
 */
export function generateVoucherText(voucherData) {
  if (!voucherData) return ''

  const lines = [
    `【栖居生活 · 缴费凭单】`,
    `房源：${voucherData.fullRoomTitle}`,
    `租客：${voucherData.tenantName}`,
    `账期：${voucherData.period} · ${voucherData.typeLabel}`,
    `应缴金额：¥ ${voucherData.amountToPayYuan}（${voucherData.chineseUppercase}）`,
    `账单编号：${voucherData.billNumber}`,
    `截止日期：${voucherData.dueDate}`,
  ]

  if (voucherData.landlordWechat) {
    lines.push(`收款微信：${voucherData.landlordWechat}`)
  }

  lines.push(`单据识别码：${voucherData.verifyCode}`)
  lines.push(`转账请备注房号与姓名；转账后请将此单据发送给房东，房东将在后台秒级核销并开具正式收据。`)

  return lines.join('\n')
}

/**
 * 绘制高分辨率缴费凭单海报（Canvas 2D / CanvasContext）
 * @param {string} canvasId 页面 canvas-id
 * @param {Object} data 结构化单据数据
 * @param {Object} vm 组件实例 this
 * @returns {Promise<string>} 返回生成的临时图片文件路径
 */
export function drawVoucherPoster(canvasId, data, vm) {
  return new Promise((resolve, reject) => {
    if (!data) {
      reject(new Error('缺少单据数据'))
      return
    }

    const width = 640
    const height = 980
    const ctx = uni.createCanvasContext(canvasId, vm)

    if (!ctx) {
      reject(new Error('创建画布上下文失败'))
      return
    }

    // 1. 背景底色：典雅温润纸白
    ctx.setFillStyle('#F9F8F5')
    ctx.fillRect(0, 0, width, height)

    // 2. 主卡片外框与阴影效果模拟
    const cardX = 36
    const cardY = 36
    const cardW = width - 72
    const cardH = height - 72

    ctx.save()
    ctx.setFillStyle('#FFFFFF')
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20)
    ctx.fill()

    // 3. 顶部卡券装饰栏（品牌金棕色色调）
    ctx.setFillStyle('#2C2825')
    drawRoundedTopRect(ctx, cardX, cardY, cardW, 110, 20)
    ctx.fill()

    // 顶部品牌标题
    ctx.setFillStyle('#F4F1EA')
    ctx.setFontSize(22)
    ctx.setTextAlign('left')
    ctx.fillText('QIJU RENTAL / 栖居租住', cardX + 28, cardY + 42)

    ctx.setFillStyle('#D4AF37')
    ctx.setFontSize(30)
    ctx.fillText('房屋租赁缴费单据', cardX + 28, cardY + 84)

    // 右上角凭单标签
    ctx.setFillStyle('rgba(212, 175, 55, 0.2)')
    drawRoundedRect(ctx, cardX + cardW - 140, cardY + 36, 112, 40, 8)
    ctx.fill()
    ctx.setFillStyle('#E5C467')
    ctx.setFontSize(20)
    ctx.setTextAlign('center')
    ctx.fillText('PAYMENT', cardX + cardW - 84, cardY + 63)

    // 4. 虚线分割线（卡券撕裂齿线风格）
    ctx.setStrokeStyle('#E2DDD5')
    ctx.setLineWidth(2)
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    ctx.moveTo(cardX + 20, cardY + 138)
    ctx.lineTo(cardX + cardW - 20, cardY + 138)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // 5. 核心金额展示区（醒目英雄金额）
    ctx.setTextAlign('center')
    ctx.setFillStyle('#7D766C')
    ctx.setFontSize(22)
    ctx.fillText(`${data.period} · ${data.typeLabel}（${data.statusLabel}）`, width / 2, cardY + 185)

    ctx.setFillStyle('#1E1B18')
    ctx.setFontSize(54)
    ctx.fillText(`¥ ${data.amountToPayYuan}`, width / 2, cardY + 250)

    // 金额大写标签气泡
    const upperText = `人民币大写：${data.chineseUppercase}`
    ctx.setFillStyle('#F5F2EB')
    drawRoundedRect(ctx, width / 2 - 220, cardY + 276, 440, 44, 22)
    ctx.fill()
    ctx.setFillStyle('#6E6659')
    ctx.setFontSize(21)
    ctx.fillText(upperText, width / 2, cardY + 306)

    // 6. 详细字段网格（表格化排版）
    const rowStartY = cardY + 360
    const rowGap = 54
    const labelX = cardX + 40
    const valueX = cardX + cardW - 40

    const rows = [
      { label: '账单编号', value: data.billNumber },
      { label: '承租房源', value: data.fullRoomTitle },
      { label: '承租租客', value: data.tenantName },
      { label: '账单总额', value: `¥ ${data.billAmountYuan}` },
      { label: '已缴金额', value: `¥ ${data.paidAmountYuan}` },
      { label: '缴费截止', value: data.dueDate },
    ]

    ctx.setFontSize(23)
    rows.forEach((r, idx) => {
      const curY = rowStartY + idx * rowGap

      // 底部分割细线
      ctx.setStrokeStyle('#F1EEE7')
      ctx.setLineWidth(1)
      ctx.beginPath()
      ctx.moveTo(labelX, curY + 14)
      ctx.lineTo(valueX, curY + 14)
      ctx.stroke()

      ctx.setTextAlign('left')
      ctx.setFillStyle('#8C857B')
      ctx.fillText(r.label, labelX, curY)

      ctx.setTextAlign('right')
      ctx.setFillStyle('#2D2926')
      ctx.fillText(r.value, valueX, curY)
    })

    // 7. 收款人与核销指引区（卡片底部）
    const footY = cardY + 705
    ctx.setFillStyle('#F8F6F0')
    drawRoundedRect(ctx, cardX + 24, footY, cardW - 48, 195, 14)
    ctx.fill()

    ctx.setTextAlign('left')
    ctx.setFillStyle('#282420')
    ctx.setFontSize(23)
    ctx.fillText('收款管家 / 房东信息：', cardX + 44, footY + 40)

    ctx.setFillStyle('#5C5449')
    ctx.setFontSize(21)
    const wechatStr = data.landlordWechat ? `微信：${data.landlordWechat}` : ''
    const phoneStr = data.landlordPhone ? `电话：${data.landlordPhone}` : ''
    ctx.fillText(`${data.landlordName}  ${wechatStr}  ${phoneStr}`, cardX + 44, footY + 74)

    ctx.setFillStyle('#B38E36')
    ctx.setFontSize(20)
    ctx.fillText('⚡ 转账请备注：房号 + 姓名', cardX + 44, footY + 108)

    // 底部核销码与防伪识别标签
    ctx.setFillStyle('#EAE5DA')
    ctx.fillRect(cardX + 44, footY + 128, cardW - 88, 1)

    ctx.setTextAlign('center')
    ctx.setFillStyle('#8E8679')
    ctx.setFontSize(19)
    ctx.fillText(`系统自动核销标识：${data.verifyCode}`, width / 2, footY + 158)
    ctx.fillText('房东粘贴此单据至管理后台，系统将自动匹配入账', width / 2, footY + 182)

    // 渲染完成并导出图片
    ctx.draw(false, () => {
      setTimeout(() => {
        uni.canvasToTempFilePath(
          {
            canvasId,
            width,
            height,
            destWidth: width * 2,
            destHeight: height * 2,
            success: (res) => resolve(res.tempFilePath),
            fail: (err) => reject(new Error(err?.errMsg || '导出单据图片失败')),
          },
          vm,
        )
      }, 200)
    })
  })
}

/**
 * 保存图片至手机系统相册，兼容权限拒绝与 H5 预览兜底
 * @param {string} tempFilePath 本地图片临时路径
 */
export function saveVoucherImage(tempFilePath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('缺少图片路径'))
      return
    }

    // #ifdef MP-WEIXIN
    uni.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        uni.showToast({ title: '单据已保存至相册', icon: 'success' })
        resolve(true)
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth deny')) {
          uni.showModal({
            title: '需要相册权限',
            content: '请允许保存图片权限，以便将缴费单据保存至手机相册发给房东',
            confirmText: '去授权',
            success: (modalRes) => {
              if (modalRes.confirm) {
                uni.openSetting()
              }
            },
          })
        } else {
          // 兜底支持预览长按保存
          uni.previewImage({
            urls: [tempFilePath],
            current: tempFilePath,
          })
        }
        reject(err)
      },
    })
    // #endif

    // #ifndef MP-WEIXIN
    uni.previewImage({
      urls: [tempFilePath],
      current: tempFilePath,
    })
    uni.showToast({ title: '长按即可保存单据图片', icon: 'none' })
    resolve(true)
    // #endif
  })
}

// 辅助绘图函数：圆角矩形
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

// 辅助绘图函数：顶部两角为圆角的矩形
function drawRoundedTopRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.lineTo(x + width, y + height)
  ctx.lineTo(x, y + height)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}
