cmake_minimum_required(VERSION 3.20)

project(CarSoccerArsenalRocketSimOracle LANGUAGES CXX)

set(ROCKETSIM_SOURCE "" CACHE PATH "Ruta al clon oficial de RocketSim usado solo para las trazas")

if(NOT EXISTS "${ROCKETSIM_SOURCE}/CMakeLists.txt")
  message(FATAL_ERROR "Indica -DROCKETSIM_SOURCE=<ruta al clon oficial de RocketSim>")
endif()

# RocketSim permanece fuera del árbol distribuible del juego. Este ejecutable
# solo enlaza el clon indicado durante la investigación de referencias.
add_subdirectory("${ROCKETSIM_SOURCE}" "${CMAKE_BINARY_DIR}/rocketsim-build")

add_executable(rocketsim_trace main.cpp)
target_compile_features(rocketsim_trace PRIVATE cxx_std_20)
target_include_directories(rocketsim_trace PRIVATE "${ROCKETSIM_SOURCE}/src")
target_link_libraries(rocketsim_trace PRIVATE RocketSim)

