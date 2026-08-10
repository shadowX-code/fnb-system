import { supabase } from "../../../../lib/supabase.ts";
import { uploadOptimizedImage } from "../../../../utils/imageUpload.js";

export async function uploadRecipePhoto(file, recipeId = "draft", previousPublicUrl = "") {
  return uploadOptimizedImage(file, {
    bucket: "inventory-item-photos",
    path: `recipe_photos/${recipeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`,
    previousPublicUrl,
  });
}

export async function findRecipeCodeMatches(code) {
  return supabase
    .from("inventory_recipes")
    .select("id, recipe_code")
    .ilike("recipe_code", code)
    .limit(5);
}
