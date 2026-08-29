idf_component_register(
  SRCS "k151_board.cpp"
  INCLUDE_DIRS "include"
  REQUIRES driver esp_lcd esp_timer esp_system esp_psram esp_video esp_codec_dev esp_driver_uart
  PRIV_REQUIRES espressif__esp_lcd_ili9341 espressif__esp32-camera
)
