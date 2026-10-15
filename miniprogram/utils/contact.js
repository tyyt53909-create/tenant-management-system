/**
 * 房东与管家联系信息工具函数
 * 提供联系信息解析、微信号与手机号复制、一键拨打电话等核心交互
 */

const DEFAULT_LANDLORD_CONTACT = {
  name: '栖居专属管家',
  phone: '13800138000',
  wechat: 'qiju_service',
  serviceHours: '09:00 - 21:00',
  emergencyPhone: '13800138000',
  notice: '紧急设施问题（如漏水、断电、门锁等）请直接拨打手机；日常生活咨询与留言欢迎添加微信沟通。',
  roomTitle: '栖居生活服务'
}

/**
 * 格式化手机号以便展示：13800138000 -> 138-0013-8000
 */
export function formatPhoneNumber(phone) {
  if (!phone) return ''
  const clean = String(phone).replace(/\s+/g, '')
  if (/^\d{11}$/.test(clean)) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`
  }
  return clean
}

/**
 * 从租客信息或合同列表中提取管家/房东联系信息
 * @param {Object} user /auth/me 返回的用户对象
 * @param {Array} contracts 合同列表或 /contracts/my 返回的数组
 * @returns {Object} 包含 name, phone, formattedPhone, wechat, serviceHours, emergencyPhone, notice, roomTitle
 */
export function getLandlordContact(user = {}, contracts = []) {
  let activeContract = null

  if (Array.isArray(contracts) && contracts.length > 0) {
    activeContract = contracts.find(c => c && c.status === 'ACTIVE') || contracts[0]
  } else if (user?.tenant?.contracts && user.tenant.contracts.length > 0) {
    activeContract = user.tenant.contracts.find(c => c && c.status === 'ACTIVE') || user.tenant.contracts[0]
  }

  const room = activeContract?.room || {}
  const building = room.building || activeContract?.building || {}
  const meta = building.metadata || {}

  const name = (meta.landlordName || meta.managerName || DEFAULT_LANDLORD_CONTACT.name).trim()
  const phone = (meta.landlordPhone || meta.managerPhone || DEFAULT_LANDLORD_CONTACT.phone).trim()
  const wechat = (meta.landlordWechat || meta.managerWechat || DEFAULT_LANDLORD_CONTACT.wechat).trim()
  const serviceHours = (meta.serviceHours || DEFAULT_LANDLORD_CONTACT.serviceHours).trim()
  const emergencyPhone = (meta.emergencyPhone || phone || DEFAULT_LANDLORD_CONTACT.emergencyPhone).trim()
  const notice = (meta.notice || DEFAULT_LANDLORD_CONTACT.notice).trim()

  const buildingName = building.name || ''
  const roomNumber = room.roomNumber || ''
  let roomTitle = DEFAULT_LANDLORD_CONTACT.roomTitle
  if (buildingName && roomNumber) {
    roomTitle = `${buildingName} · ${roomNumber}室`
  } else if (buildingName) {
    roomTitle = buildingName
  }

  return {
    name,
    phone,
    formattedPhone: formatPhoneNumber(phone),
    wechat,
    serviceHours,
    emergencyPhone,
    notice,
    roomTitle
  }
}

/**
 * 复制文本到剪贴板并给出清晰反馈
 * @param {string} text 要复制的文本
 * @param {string} label 字段说明，如 "微信号"、"电话号码"
 */
export function copyToClipboard(text, label = '内容') {
  if (!text) {
    uni.showToast({ title: '暂无可复制内容', icon: 'none' })
    return
  }

  const content = String(text).trim()
  uni.setClipboardData({
    data: content,
    success: () => {
      uni.showToast({
        title: `${label}已复制`,
        icon: 'success',
        duration: 2000
      })
    },
    fail: () => {
      uni.showToast({
        title: '复制失败，请重试',
        icon: 'none'
      })
    }
  })
}

/**
 * 调起系统拨打电话
 * @param {string} phoneNumber 电话号码
 */
export function makePhoneCall(phoneNumber) {
  if (!phoneNumber) {
    uni.showToast({ title: '未设置联系电话', icon: 'none' })
    return
  }

  const cleanNumber = String(phoneNumber).replace(/[^0-9+]/g, '')
  uni.makePhoneCall({
    phoneNumber: cleanNumber,
    fail: () => {
      // 在部分非手机环境（如微信开发者工具/浏览器）可能静默取消，打印日志并降级提示
      console.log('用户取消拨打或当前环境不支持拨打电话')
    }
  })
}
