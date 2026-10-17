export const FAQ_CATEGORIES = [
 ['general','General'], ['operating_hours','Operating Hours'], ['location','Location'],
 ['menu_drinks','Menu & Drinks'], ['reservations','Reservations'], ['promotions','Promotions'],
 ['services','Services'], ['payment','Payment'], ['feedback_complaints','Feedback & Complaints'], ['others','Others'],
].map(([value,label])=>({value,label}));
export const faqCategoryLabel = value => FAQ_CATEGORIES.find(c=>c.value===value)?.label || value || 'General';
