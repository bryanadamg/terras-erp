"""Dye recipe writes shared by the dyeing router and the legacy loader."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dyeing_setting import DyeRecipe, DyeRecipeFinishing, DyeRecipeLine, DyeRecipeWashBath


async def create_recipe(db: AsyncSession, *, lines: list[dict], wash_baths: list[dict],
                        finishing_steps: list[dict], **header) -> DyeRecipe:
    """Insert a recipe with its lines, wash baths and finishing steps, already validated
    and resolved by the caller (line dicts carry item_id, wash/finish dicts carry
    attribute_value_id + description). Flushes; the caller commits."""
    recipe = DyeRecipe(**header)
    db.add(recipe)
    await db.flush()
    db.add_all([DyeRecipeLine(recipe_id=recipe.id, **ln) for ln in lines])
    db.add_all([DyeRecipeWashBath(recipe_id=recipe.id, **wb) for wb in wash_baths])
    db.add_all([DyeRecipeFinishing(recipe_id=recipe.id, **fs) for fs in finishing_steps])
    await db.flush()
    return recipe
