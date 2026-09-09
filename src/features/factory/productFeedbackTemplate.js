const bmLabels = {
  "Usual spice tolerance": "Tahap toleransi kepedasan anda", "How is the sambal spiciness?": "Bagaimana tahap kepedasan sambal ini?", "How is the saltiness?": "Bagaimana tahap kemasinan?", "How is the texture?": "Bagaimana teksturnya?", "Overall rating": "Penilaian keseluruhan", "Would you buy this?": "Adakah anda akan membelinya?", "What matters most to you?": "Apakah yang paling penting bagi anda?", "What is the main improvement?": "Apakah penambahbaikan utama?", "Acceptable price for a 20g pack": "Harga yang boleh diterima untuk pek 20g", "Packaging preference": "Pilihan pembungkusan", "Age range": "Julat umur",
};

export const sambalFeedbackTemplate = [
  ["spice_tolerance", "Usual spice tolerance", "您平时能接受的辣度", "single_choice", ["Not spicy", "Mild", "Medium", "Very spicy", "Super spicy"]],
  ["sambal_spiciness", "How is the sambal spiciness?", "这款参巴辣度如何？", "single_choice", ["Too mild", "Just right", "Prefer spicier", "Too spicy"]],
  ["saltiness", "How is the saltiness?", "这款产品的咸度如何？", "single_choice", ["Too salty", "Just right", "Prefer saltier", "Too bland"]],
  ["texture", "How is the texture?", "口感如何？", "single_choice", ["Smooth", "Thick", "Too watery", "Too oily", "Too dry"]],
  ["overall_rating", "Overall rating", "整体评分", "rating", ["1", "2", "3", "4", "5"]],
  ["purchase_intent", "Would you buy this?", "您会购买吗？", "single_choice", ["Yes", "Maybe", "No"]],
  ["matters_most", "What matters most to you?", "您最在意什么？", "multi_choice", ["Spiciness", "Aroma", "Texture", "Flavor", "Freshness", "Not oily", "Balanced sweetness", "Balanced saltiness"]],
  ["main_improvement", "What is the main improvement?", "最需要改善的是？", "single_choice", ["Spiciness", "Sweetness", "Saltiness", "Aroma", "Texture", "Packaging", "Portion", "Nothing — it’s good"]],
  ["price_20g", "Acceptable price for a 20g pack", "20克包装可接受的价格", "price_choice", ["RM0.80", "RM1.00", "RM1.50", "RM2.00", "RM2.50+"]],
  ["packaging_preference", "Packaging preference", "包装偏好", "image_choice", []],
  ["age", "Age range", "年龄范围", "single_choice", ["13–18", "19–25", "26–35", "36–45", "46+"]],
].map(([key, labelEn, labelZh, type, options], order) => ({ key, label_en: labelEn, label_zh: labelZh, label_ms: bmLabels[labelEn] || labelEn, helper_en: "", helper_zh: "", helper_ms: "", type, required: key !== "packaging_preference", order: order + 1, options: options.map((value) => ({ value, label_en: value, label_zh: value, label_ms: value })) }));

export const productFeedbackQuestionTypes = ["single_choice", "multi_choice", "rating", "price_choice", "short_text", "image_choice"];
