cmake_minimum_required(VERSION 3.20)

project(CarSoccerArsenalRocketSimBridge LANGUAGES CXX)

set(ROCKETSIM_SOURCE "" CACHE PATH "Ruta al clon fijado de RocketSim")

if(NOT EXISTS "${ROCKETSIM_SOURCE}/CMakeLists.txt")
  message(FATAL_ERROR "Indica -DROCKETSIM_SOURCE=<ruta al clon de RocketSim>")
endif()

add_subdirectory("${ROCKETSIM_SOURCE}" "${CMAKE_BINARY_DIR}/rocketsim-build")

add_executable(rocketsim_bridge main.cpp)
target_compile_features(rocketsim_bridge PRIVATE cxx_std_20)
# Keep the bridge independent from the machine-wide PDB server. Some Windows
# installations have a stale /Zi server after a Visual Studio update; the
# embedded debug format keeps this small native tool buildable and reversible.
if(MSVC)
  target_compile_options(rocketsim_bridge PRIVATE /Z7)
endif()
target_include_directories(rocketsim_bridge PRIVATE
  "${ROCKETSIM_SOURCE}/src"
  "${ROCKETSIM_SOURCE}/libsrc/bullet3-3.24"
  "${CMAKE_CURRENT_LIST_DIR}/../shared"
)
target_link_libraries(rocketsim_bridge PRIVATE RocketSim)
