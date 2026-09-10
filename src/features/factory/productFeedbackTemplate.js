const bmLabels = {
  "Usual spice tolerance": "Tahap toleransi kepedasan anda", "How is the sambal spiciness?": "Bagaimana tahap kepedasan sambal ini?", "How is the saltiness?": "Bagaimana tahap kemasinan?", "How is the texture?": "Bagaimana teksturnya?", "Overall rating": "Penilaian keseluruhan", "Would you buy this?": "Adakah anda akan membelinya?", "What matters most to you?": "Apakah yang paling penting bagi anda?", "What is the main improvement?": "Apakah penambahbaikan utama?", "Acceptable price for a 20g pack": "Harga yang boleh diterima untuk pek 20g", "Packaging preference": "Pilihan pembungkusan", "Age range": "Julat umur",
};

const zhOptionLabels = {
  "Not spicy": "不辣", Mild: "微辣", Medium: "中辣", "Very spicy": "很辣", "Super spicy": "超辣",
  "Too mild": "太不辣", "Just right": "刚刚好", "Prefer spicier": "希望更辣", "Too spicy": "太辣",
  "Too salty": "太咸", "Prefer saltier": "希望更咸", "Too bland": "太淡",
  Smooth: "顺滑", Thick: "浓稠", "Too watery": "太稀", "Too oily": "太油", "Too dry": "太干",
  Yes: "会", Maybe: "可能", No: "不会", Spiciness: "辣度", Aroma: "香气", Texture: "口感", Flavor: "味道", Freshness: "新鲜度", "Not oily": "不油腻", "Balanced sweetness": "甜度平衡", "Balanced saltiness": "咸度平衡",
  Sweetness: "甜度", Saltiness: "咸度", Packaging: "包装", Portion: "份量", "Nothing — it’s good": "无需改善，已经很好",
  "RM0.80": "RM0.80", "RM1.00": "RM1.00", "RM1.50": "RM1.50", "RM2.00": "RM2.00", "RM2.50+": "RM2.50以上",
  "13–18": "13–18岁", "19–25": "19–25岁", "26–35": "26–35岁", "36–45": "36–45岁", "46+": "46岁以上",
};

const msOptionLabels = {
  "Not spicy": "Tidak pedas", Mild: "Sedikit pedas", Medium: "Sederhana pedas", "Very spicy": "Sangat pedas", "Super spicy": "Terlalu pedas",
  "Too mild": "Terlalu kurang pedas", "Just right": "Sesuai", "Prefer spicier": "Lebih pedas", "Too spicy": "Terlalu pedas",
  "Too salty": "Terlalu masin", "Prefer saltier": "Lebih masin", "Too bland": "Terlalu tawar",
  Smooth: "Lembut", Thick: "Pekat", "Too watery": "Terlalu cair", "Too oily": "Terlalu berminyak", "Too dry": "Terlalu kering",
  Yes: "Ya", Maybe: "Mungkin", No: "Tidak", Spiciness: "Kepedasan", Aroma: "Aroma", Texture: "Tekstur", Flavor: "Rasa", Freshness: "Kesegaran", "Not oily": "Tidak berminyak", "Balanced sweetness": "Kemanisan seimbang", "Balanced saltiness": "Kemasinan seimbang",
  Sweetness: "Kemanisan", Saltiness: "Kemasinan", Packaging: "Pembungkusan", Portion: "Saiz hidangan", "Nothing — it’s good": "Tiada, sudah baik",
  "RM0.80": "RM0.80", "RM1.00": "RM1.00", "RM1.50": "RM1.50", "RM2.00": "RM2.00", "RM2.50+": "RM2.50+",
  "13–18": "13–18", "19–25": "19–25", "26–35": "26–35", "36–45": "36–45", "46+": "46+",
};

const questionRoles = {
  overall_rating: "overall_rating",
  purchase_intent: "purchase_intent",
  sambal_spiciness: "taste_spiciness",
  price_20g: "price_acceptance",
};

const priceOptions = [
  ["RM0.80", 0.8],
  ["RM1.00", 1],
  ["RM1.50", 1.5],
  ["RM2.00", 2],
  ["RM2.50+", 2.5],
];

export const sambalFeedbackTemplate = [
  ["spice_tolerance", "Usual spice tolerance", "您平时能接受的辣度", "single_choice", ["Not spicy", "Mild", "Medium", "Very spicy", "Super spicy"]],
  ["sambal_spiciness", "How is the sambal spiciness?", "这款参巴辣度如何？", "single_choice", ["Too mild", "Just right", "Prefer spicier", "Too spicy"]],
  ["saltiness", "How is the saltiness?", "这款产品的咸度如何？", "single_choice", ["Too salty", "Just right", "Prefer saltier", "Too bland"]],
  ["texture", "How is the texture?", "口感如何？", "single_choice", ["Smooth", "Thick", "Too watery", "Too oily", "Too dry"]],
  ["overall_rating", "Overall rating", "整体评分", "rating", ["1", "2", "3", "4", "5"]],
  ["purchase_intent", "Would you buy this?", "您会购买吗？", "single_choice", ["Yes", "Maybe", "No"]],
  ["matters_most", "What matters most to you?", "您最在意什么？", "multi_choice", ["Spiciness", "Aroma", "Texture", "Flavor", "Freshness", "Not oily", "Balanced sweetness", "Balanced saltiness"]],
  ["main_improvement", "What is the main improvement?", "最需要改善的是？", "single_choice", ["Spiciness", "Sweetness", "Saltiness", "Aroma", "Texture", "Packaging", "Portion", "Nothing — it’s good"]],
  ["price_20g", "Acceptable price for a 20g pack", "20克包装可接受的价格", "price_choice", priceOptions],
  ["packaging_preference", "Packaging preference", "包装偏好", "image_choice", []],
  ["age", "Age range", "年龄范围", "single_choice", ["13–18", "19–25", "26–35", "36–45", "46+"]],
].map(([key, labelEn, labelZh, type, options], order) => ({
  key,
  label_en: labelEn,
  label_zh: labelZh,
  label_ms: bmLabels[labelEn] || labelEn,
  helper_en: "",
  helper_zh: "",
  helper_ms: "",
  type,
  required: key !== "packaging_preference",
  order: order + 1,
  analytics_role: questionRoles[key] || null,
  analytics_target_value: key === "purchase_intent" ? "Yes" : key === "sambal_spiciness" ? "Just right" : null,
  options: options.map((option) => {
    const [value, amount] = Array.isArray(option) ? option : [option, null];
    return {
      value,
      label_en: value,
      label_zh: zhOptionLabels[value] || value,
      label_ms: msOptionLabels[value] || value,
      ...(amount === null ? {} : { amount, currency: "MYR", display_label: value }),
    };
  }),
}));

export const productFeedbackQuestionTypes = ["single_choice", "multi_choice", "rating", "price_choice", "short_text", "image_choice"];
