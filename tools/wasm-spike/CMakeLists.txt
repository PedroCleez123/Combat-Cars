cmake_minimum_required(VERSION 3.20)
project(rocketsim_wasm_spike LANGUAGES CXX)

if(NOT DEFINED ROCKETSIM_SOURCE OR NOT EXISTS "${ROCKETSIM_SOURCE}/CMakeLists.txt")
  message(FATAL_ERROR "Set ROCKETSIM_SOURCE to the RocketSim checkout containing CMakeLists.txt")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(RS_DONT_LOG ON CACHE BOOL "Disable RocketSim stdout logging" FORCE)

add_subdirectory("${ROCKETSIM_SOURCE}" "${CMAKE_BINARY_DIR}/rocketsim")
target_compile_definitions(RocketSim PRIVATE RS_DONT_LOG)

add_executable(rocketsim_wasm wrapper.cpp)
set_target_properties(rocketsim_wasm PROPERTIES SUFFIX ".mjs")
target_include_directories(rocketsim_wasm PRIVATE "${ROCKETSIM_SOURCE}/src" "${CMAKE_CURRENT_LIST_DIR}/../shared")
target_compile_options(rocketsim_wasm PRIVATE "-iquote${ROCKETSIM_SOURCE}/libsrc/bullet3-3.24")
target_link_libraries(rocketsim_wasm PRIVATE RocketSim)
target_compile_definitions(rocketsim_wasm PRIVATE RS_DONT_LOG)

if(EMSCRIPTEN)
  target_link_options(rocketsim_wasm PRIVATE
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createRocketSimWasm"
    "-sENVIRONMENT=node,web"
    "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=134217728"
    "-sMAXIMUM_MEMORY=536870912"
    "-sASSERTIONS=1"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_rs_init','_rs_init_trace_air_void','_rs_init_trace_air_void_cars','_rs_init_trace_clean_ground','_rs_init_trace_clean_wall_contact','_rs_init_trace_curved_practice','_rs_init_trace_combat_lineup','_rs_init_trace_combat_alpha','_rs_init_trace_combat_alpha_wall','_rs_init_trace_combat_alpha_ramp','_rs_init_trace_combat_alpha_cover_contact','_rs_init_trace_combat_alpha_lobby_bump','_rs_init_combat_alpha_roster','_rs_init_trace_combat_alpha_pair','_rs_set_combat_active_car','_rs_respawn_car','_rs_contain_car','_rs_set_authority_rules','_rs_boost_regeneration_contract','_rs_refill_car_boost','_rs_destroy','_rs_set_controls','_rs_set_controls_for_car','_rs_set_controls_for_car_full','_rs_step','_rs_snapshot','_rs_snapshot_car','_rs_snapshot_car_presentation','_rs_snapshot_car_authority','_rs_snapshot_combat_pads','_rs_raycast_static','_rs_is_grounded_car','_rs_body_contact_car','_rs_wheel_contact_car']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPF32','HEAPU32']"
  )
else()
  message(FATAL_ERROR "Configure with emcmake and the Emscripten toolchain")
endif()
